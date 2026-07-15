import type Database from "better-sqlite3";
import type { Octokit } from "@octokit/rest";
import type { AdtConfig, ExecutorResult, JobRow, TriggerEvent } from "./types.js";
import {
  activeJob, allJobs, deleteExpiredJobs, enqueueEvent, findResumableJob, findWorkspace,
  consumeCancelRequests, getCursor, getJob, openStore, queuedJobs, resetInterruptedJobs,
  setCursor, transition, updateJob,
} from "./store.js";
import {
  addEyesReaction, ensureStatusLabels, githubClient, itemTitle, pollEvents, postComment,
  prMerged, pullRequestInfo, setStatusLabel, threadContext,
} from "./github.js";
import { classifyIntent, isCancelCommand, isResumeCommand, shouldAcceptTrigger, stripMention } from "./intent.js";
import { ruleReview } from "./security.js";
import { branchName, ensureWorktree, removeWorktree, repositoryConfig } from "./workspace.js";
import { CcMmExecutor } from "./executor.js";
import { deliver, ensurePlanDirectory, planRelativePath } from "./delivery.js";

export class Worker {
  readonly db: Database.Database;
  readonly client: Octokit;
  private readonly executor: CcMmExecutor;
  private readonly active = new Map<number, AbortController>();
  private initialized = false;

  constructor(readonly config: AdtConfig, db?: Database.Database, client?: Octokit) {
    this.db = db ?? openStore();
    this.client = client ?? githubClient();
    this.executor = new CcMmExecutor(config);
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    resetInterruptedJobs(this.db);
    for (const repository of this.config.repositories) {
      await ensureStatusLabels(this.client, repository.name);
    }
    this.initialized = true;
  }

  async tick(): Promise<void> {
    await this.initialize();
    for (const jobId of consumeCancelRequests(this.db)) this.cancel(jobId);
    await this.poll();
    await this.cleanupMerged();
    this.schedule();
    deleteExpiredJobs(this.db, this.config.retentionDays);
  }

  async shutdown(): Promise<void> {
    for (const controller of this.active.values()) controller.abort();
    await Promise.allSettled([...this.active.keys()].map(async (id) => {
      while (this.active.has(id)) await new Promise((resolve) => setTimeout(resolve, 50));
    }));
    this.db.close();
  }

  cancel(jobId: number): boolean {
    const controller = this.active.get(jobId);
    if (controller) controller.abort();
    const job = getJob(this.db, jobId);
    if (!job || !["queued", "running", "needs-input"].includes(job.status)) return false;
    transition(this.db, jobId, "cancelled");
    return true;
  }

  get activeCount(): number {
    return this.active.size;
  }

  private async poll(): Promise<void> {
    for (const repository of this.config.repositories) {
      const startedAt = new Date().toISOString();
      const since = getCursor(this.db, repository.name) ?? new Date(Date.now() - 60_000).toISOString();
      const events = await pollEvents(this.client, this.config, repository.name, since);
      for (const event of events) await this.acceptEvent(event);
      setCursor(this.db, repository.name, startedAt);
    }
  }

  private async acceptEvent(event: TriggerEvent): Promise<void> {
    if (!shouldAcceptTrigger(this.config, event)) return;
    const instruction = stripMention(event.body, this.config.github.agentUser);
    const mode = classifyIntent(instruction);
    const id = enqueueEvent(this.db, event, instruction, mode);
    if (id === null) return;
    await addEyesReaction(this.client, event).catch(() => undefined);

    if (isCancelCommand(instruction)) {
      const target = activeJob(this.db, event.repo, event.number, id);
      if (target) this.cancel(target.id);
      transition(this.db, id, "done");
      await setStatusLabel(this.client, event.repo, event.number, "cancelled");
      await postComment(this.client, event.repo, event.number,
        target ? `已取消 ADT 任务 A-${target.id}，现场已保留。` : "当前没有可取消的 ADT 任务。");
      return;
    }

    const resumable = findResumableJob(this.db, event.repo, event.number);
    if (resumable && (resumable.status === "needs-input" || isResumeCommand(instruction))) {
      updateJob(this.db, id, {
        phase: resumable.phase,
        mode: resumable.mode,
        session_id: resumable.session_id,
        worktree_path: resumable.worktree_path,
        branch: resumable.branch,
        plan_path: resumable.plan_path,
        pr_number: resumable.pr_number,
      });
      this.db.prepare("UPDATE jobs SET instruction = ? WHERE id = ?")
        .run(`${resumable.instruction}\n\nHuman follow-up:\n${instruction}`, id);
      transition(this.db, resumable.id, "done");
    }
    await setStatusLabel(this.client, event.repo, event.number, "queued");
  }

  private schedule(): void {
    const capacity = this.config.maxConcurrent - this.active.size;
    if (capacity <= 0) return;
    for (const job of queuedJobs(this.db, capacity)) {
      const controller = new AbortController();
      this.active.set(job.id, controller);
      void this.run(job.id, controller).finally(() => this.active.delete(job.id));
    }
  }

  private async run(jobId: number, controller: AbortController): Promise<void> {
    const initialJob = getJob(this.db, jobId);
    if (!initialJob) return;
    let job: JobRow = initialJob;
    try {
      transition(this.db, job.id, "running", job.phase);
      await setStatusLabel(this.client, job.repo, job.number, "running");
      await postComment(this.client, job.repo, job.number, `api001 已开始处理，任务 ID：A-${job.id}。`);

      const repository = repositoryConfig(this.config.repositories, job.repo);
      const previous = findWorkspace(this.db, job.repo, job.number);
      let worktree = job.worktree_path ?? previous?.worktree_path ?? null;
      let branch = job.branch ?? previous?.branch ?? null;
      let prNumber = job.pr_number ?? previous?.pr_number ?? (job.is_pull_request ? job.number : null);
      if (!worktree || !branch) {
        if (job.is_pull_request) {
          const pull = await pullRequestInfo(this.client, job.repo, job.number);
          branch = pull.branch;
          worktree = ensureWorktree(repository, job.number, branch, true);
        } else {
          branch = branchName(job.number, job.instruction);
          worktree = ensureWorktree(repository, job.number, branch, false);
        }
      }
      updateJob(this.db, job.id, { worktree_path: worktree, branch, pr_number: prNumber });
      job = getJob(this.db, job.id)!;
      const context = await threadContext(this.client, job.repo, job.number);

      const rules = ruleReview(job.instruction);
      const humanConfirmed = /Human follow-up:\s*(?:确认|同意|继续|confirm|yes|proceed)/i.test(job.instruction);
      if (rules.decision === "deny") {
        await this.finish(job, "failed", `安全审查拒绝了请求：${rules.reasons.join("；")}`);
        return;
      }
      if (rules.decision === "confirm" && !humanConfirmed) {
        await this.needInput(job, "执行前需要确认", rules.reasons.map((reason) => `是否确认继续？风险：${reason}`));
        return;
      }
      const review = await this.executor.reviewSafety(repository, worktree, job.instruction, context, controller.signal);
      if (review.decision === "deny") {
        await this.finish(job, "failed", `安全审查拒绝了请求：${review.risks.join("；")}`);
        return;
      }
      if (review.decision === "confirm" && !humanConfirmed) {
        await this.needInput(job, "执行前需要确认", review.risks.map((risk) => `是否确认继续？风险：${risk}`));
        return;
      }

      if (job.mode === "read") {
        transition(this.db, job.id, "running", "analysis");
        const output = await this.withRetry(job, () => this.executor.analyze(
          repository, worktree, job.instruction, context, job.session_id, controller.signal,
        ));
        updateJob(this.db, job.id, { session_id: output.sessionId });
        await this.handleExecutorResult(job, output.result);
        return;
      }

      const planPath = job.plan_path ?? planRelativePath(job.number, job.instruction);
      ensurePlanDirectory(worktree, planPath);
      let sessionId = job.session_id;
      if (job.phase === "security" || job.phase === "planning") {
        transition(this.db, job.id, "running", "planning");
        const planning = await this.withRetry(job, () => this.executor.plan(
          repository, worktree, job.instruction, context, planPath, sessionId, controller.signal,
        ));
        sessionId = planning.sessionId;
        updateJob(this.db, job.id, { session_id: sessionId, plan_path: planPath });
        if (planning.result.status !== "done") {
          await this.handleExecutorResult(job, planning.result);
          return;
        }
      }

      transition(this.db, job.id, "running", "implementing");
      const implementation = await this.withRetry(job, () => this.executor.implement(
        repository, worktree, job.instruction, context, planPath, sessionId!, controller.signal,
      ));
      updateJob(this.db, job.id, { session_id: implementation.sessionId });
      if (implementation.result.status !== "done") {
        await this.handleExecutorResult(job, implementation.result);
        return;
      }

      transition(this.db, job.id, "running", "delivering");
      const title = await itemTitle(this.client, job.repo, job.number);
      const delivered = await deliver(
        this.client, repository, worktree, branch, job.number, title,
        implementation.result.summary, implementation.result.tests ?? [], prNumber,
      );
      updateJob(this.db, job.id, { pr_number: delivered.prNumber });
      await this.finish(job, "done",
        `实现完成并已提交。\n\n- Draft PR：${delivered.url}\n- Commit：\`${delivered.commit.slice(0, 12)}\`\n- 摘要：${implementation.result.summary}`);
    } catch (error) {
      job = getJob(this.db, job.id) ?? job;
      if (controller.signal.aborted) {
        transition(this.db, job.id, "cancelled", job.phase, "Cancelled by user");
        await setStatusLabel(this.client, job.repo, job.number, "cancelled").catch(() => undefined);
      } else {
        await this.finish(job, "failed", `任务失败：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private async withRetry<T extends { sessionId: string }>(job: JobRow, action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (first) {
      updateJob(this.db, job.id, { attempts: job.attempts + 1, last_error: String(first) });
      return action();
    }
  }

  private async handleExecutorResult(job: JobRow, result: ExecutorResult): Promise<void> {
    job = getJob(this.db, job.id) ?? job;
    if (result.status === "needs-input") {
      await this.needInput(job, result.summary, result.questions);
    } else if (result.status === "failed") {
      await this.finish(job, "failed", `${result.summary}\n\n${result.error}`);
    } else {
      await this.finish(job, "done", result.summary);
    }
  }

  private async needInput(job: JobRow, summary: string, questions: string[]): Promise<void> {
    job = getJob(this.db, job.id) ?? job;
    transition(this.db, job.id, "needs-input", job.phase);
    await setStatusLabel(this.client, job.repo, job.number, "needs-input");
    await postComment(this.client, job.repo, job.number,
      [`## api001 需要你的判断`, "", summary, "", ...questions.map((question, index) => `${index + 1}. ${question}`), "", `请回复并再次 @${this.config.github.agentUser}。`].join("\n"));
  }

  private async finish(job: JobRow, status: "done" | "failed", message: string): Promise<void> {
    // Keep the phase written by the latest workflow step. The JobRow passed to
    // finish can be stale after planning/implementation/delivery transitions.
    transition(this.db, job.id, status, undefined, status === "failed" ? message : null);
    await setStatusLabel(this.client, job.repo, job.number, status);
    await postComment(this.client, job.repo, job.number, `## api001 ${status === "done" ? "已完成" : "执行失败"}\n\n${message}`);
  }

  private async cleanupMerged(): Promise<void> {
    for (const job of allJobs(this.db, 500)) {
      if (!job.pr_number || !job.worktree_path) continue;
      if (!await prMerged(this.client, job.repo, job.pr_number).catch(() => false)) continue;
      const repository = repositoryConfig(this.config.repositories, job.repo);
      removeWorktree(repository, job.worktree_path);
      updateJob(this.db, job.id, { worktree_path: null });
    }
  }
}
