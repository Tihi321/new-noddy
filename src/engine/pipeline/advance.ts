import type {
  EpisodeMeta,
  QaResult,
  QaOwnerTask,
  Stage,
} from "../../shared/episode";
import type { PipelineConfig } from "../../shared/schemas";
import type { JobState, NewJob } from "../queue/jobs";
import { groupIssues, issueLines } from "./qa";

/** The job role of each task. */
export const TASK_ROLE: Record<string, string> = {
  brief: "producer",
  outline: "screenwriter",
  script: "screenwriter",
  rewrite: "screenwriter",
  review: "story_editor",
  cast: "character_designer",
  sets: "set_designer",
  shots: "director",
  actions: "animator",
  music: "composer",
  sfx: "sound_designer",
  qa: "qa",
  build_puppet: "puppet_workshop",
  build_set: "puppet_workshop",
  voice_lines: "foley_booth",
  compile_tracks: "animation_compiler",
  mix_audio: "foley_booth",
  preview_shot: "preview_crew",
  animatic: "preview_crew",
  render_shot: "render_farm",
  edit_episode: "editor",
};

/** Role of the owner of a QA fix. */
export const FIX_ROLE: Record<QaOwnerTask, string> = {
  cast: "character_designer",
  sets: "set_designer",
  shots: "director",
  actions: "animator",
  music: "composer",
  sfx: "sound_designer",
};

/** Tasks that tool crews run (no model). */
export const TOOL_TASKS = [
  "build_puppet",
  "build_set",
  "voice_lines",
  "compile_tracks",
  "mix_audio",
  "preview_shot",
  "animatic",
  "render_shot",
  "edit_episode",
] as const;

export const DEFAULT_MAX_REVIEW_ROUNDS = 2;
export const DEFAULT_MAX_QA_ROUNDS = 2;

/** A job to enqueue, with the request text for its body. */
export type PlanJob = NewJob & { body?: string };

export interface Plan {
  /** Changes to episode.md (applied before the jobs are enqueued). */
  patch: Partial<EpisodeMeta>;
  jobs: PlanJob[];
}

export interface JobInfo {
  state: JobState;
  failure?: string;
}

/** Everything `advance` looks at: the episode's files and job files, already read. */
export interface EpisodeState {
  id: string;
  meta: EpisodeMeta;
  /** This episode's jobs by id. */
  jobs: Map<string, JobInfo>;
  /** review-N.json files by N. */
  reviews: Map<
    number,
    { verdict: "pass" | "revise"; source: "editor" | "user" }
  >;
  castIds: string[];
  setIds: string[];
  shotIds: string[];
  /** qa.json, when it exists and is valid. */
  qa: QaResult | null;
  /** Who wrote the script (notes/writer.json): the rewrite goes to the same agent, the review avoids the same model family. */
  writer: { family: string | null; agent: string | null };
}

export const TERMINAL_STAGES: ReadonlySet<string> = new Set(["done", "failed"]);

/** Deterministic job id: `<episode>--<task>--<unit>--<tag>`. */
export function jobId(
  episode: string,
  task: string,
  unit: string | null | undefined,
  tag: string,
): string {
  return `${episode}--${task}--${unit || "all"}--${tag}`;
}

interface Spec {
  task: string;
  unit?: string | null;
  tag: string;
  role?: string;
  round?: number;
  body?: string;
  extra?: Partial<NewJob>;
}

/**
 * The planner. Looks at the episode's state and says what to change in episode.md and which jobs to enqueue.
 * It is pure: calling it again with the same state gives the same plan, and job ids are deterministic, so enqueuing
 * twice is harmless. Tool stages just enqueue the tool tasks named in docs/contracts.md. A stage is finished when its
 * jobs are done; a failed job fails the episode with the reason in `error`.
 */
export function advance(state: EpisodeState, config: PipelineConfig): Plan {
  const { meta } = state;
  const none: Plan = { patch: {}, jobs: [] };
  if (TERMINAL_STAGES.has(meta.stage)) return none;

  const maxReview = config.max_review_rounds ?? DEFAULT_MAX_REVIEW_ROUNDS;
  const maxQa = config.max_qa_rounds ?? DEFAULT_MAX_QA_ROUNDS;
  const c = `c${meta.cut}`;
  const note = meta.cut > 0 ? meta.cutNote : "";

  const toJob = (s: Spec): PlanJob => ({
    id: jobId(state.id, s.task, s.unit, s.tag),
    task: s.task,
    role: s.role ?? TASK_ROLE[s.task]!,
    episode: state.id,
    unit: s.unit ?? null,
    round: s.round ?? 0,
    requested_by: "engine",
    ...s.extra,
    ...(s.body ? { body: s.body } : {}),
  });

  /** Where the jobs of a stage stand. */
  const look = (
    specs: Spec[],
  ): {
    status: "done" | "wait" | "failed";
    enqueue: PlanJob[];
    error?: string;
  } => {
    const enqueue: PlanJob[] = [];
    let waiting = false;
    for (const s of specs) {
      const job = toJob(s);
      const info = state.jobs.get(job.id);
      if (info?.state === "failed") {
        return {
          status: "failed",
          enqueue: [],
          error: `${s.task}${s.unit ? " " + s.unit : ""} failed: ${info.failure ?? "see jobs/failed"}`,
        };
      }
      if (!info) {
        enqueue.push(job);
        waiting = true;
      } else if (info.state !== "done") waiting = true;
    }
    return { status: waiting ? "wait" : "done", enqueue };
  };

  const go = (stage: Stage): Plan => ({
    patch: {
      stage,
      status:
        stage === "done"
          ? "done"
          : stage.startsWith("approve_")
            ? "awaiting_approval"
            : "running",
      error: null,
    },
    jobs: [],
  });
  const fail = (error: string): Plan => ({
    patch: {
      stage: "failed",
      status: "failed",
      error,
      failedStage: meta.stage,
    },
    jobs: [],
  });
  /** Runs one set of jobs, and moves on to `next` when they are done. */
  const run = (specs: Spec[], next: () => Plan): Plan => {
    const r = look(specs);
    if (r.status === "failed") return fail(r.error!);
    if (r.status === "done") return next();
    return { patch: {}, jobs: r.enqueue };
  };

  switch (meta.stage) {
    case "brief":
      return run([{ task: "brief", tag: "r0" }], () => go("outline"));
    case "outline":
      return run([{ task: "outline", tag: "r0" }], () => go("script"));
    case "script":
      return run([{ task: "script", tag: "r0" }], () => go("review"));

    case "review": {
      const n = meta.round;
      const toApproval = (): Plan =>
        meta.approvals.script && !meta.approved.script
          ? go("approve_script")
          : go("design");
      const rv = state.reviews.get(n);
      if (!rv) {
        const r = look([
          {
            task: "review",
            tag: `r${n}`,
            round: n,
            extra: { avoid_family: state.writer.family },
          },
        ]);
        if (r.status === "failed") return fail(r.error!);
        if (r.status === "done")
          return fail(
            `review ${n} finished without writing reviews/review-${n}.json`,
          );
        return { patch: {}, jobs: r.enqueue };
      }
      if (rv.verdict === "pass") return toApproval();
      // revise: a change request from the user always gets a rewrite, the story editor's own limit is max_review_rounds
      const allowed = rv.source === "user" || n - meta.roundBase < maxReview;
      if (!allowed) return toApproval();
      return run(
        [
          {
            task: "rewrite",
            tag: `r${n}`,
            round: n,
            extra: { agent_hint: state.writer.agent },
          },
        ],
        () => ({ patch: { round: n + 1 }, jobs: [] }),
      );
    }

    case "approve_script":
      if (meta.approved.script || !meta.approvals.script) return go("design");
      return meta.status === "awaiting_approval"
        ? none
        : { patch: { status: "awaiting_approval" }, jobs: [] };

    case "design":
      return run(
        [
          { task: "cast", tag: "r0" },
          { task: "sets", tag: "r0" },
        ],
        () => go("shots"),
      );

    case "shots":
      return run([{ task: "shots", tag: c, round: meta.cut, body: note }], () =>
        go("animate"),
      );

    case "animate": {
      if (state.shotIds.length === 0) return fail("shots.json has no shots");
      const specs: Spec[] = [
        ...state.shotIds.map((id): Spec => ({
          task: "actions",
          unit: id,
          tag: c,
          round: meta.cut,
          body: note,
        })),
        { task: "music", tag: c },
        { task: "sfx", tag: c },
      ];
      return run(specs, () => ({
        patch: { stage: "qa", status: "running", error: null, qaRound: 0 },
        jobs: [],
      }));
    }

    case "qa": {
      const q = meta.qaRound;
      const r = look([{ task: "qa", tag: `${c}q${q}`, round: q }]);
      if (r.status === "failed") return fail(r.error!);
      if (r.status === "wait") return { patch: {}, jobs: r.enqueue };
      const result = state.qa;
      if (!result || result.round !== q)
        return fail(`qa round ${q} finished without writing qa.json`);
      // Only errors send work back to a crew. Warnings stay in qa.json (and the log) but never cost a fix round:
      // a model cannot reliably fix things like a total length, and each round takes a minute or more.
      const errors = result.issues.filter((i) => i.severity === "error");
      if (errors.length === 0) return go("assets");
      if (q >= maxQa)
        return fail(`QA still finds problems after ${q} fix round(s):
${issueLines(errors)}`);
      const fixes: Spec[] = groupIssues(result.issues)
        .filter((g) => g.issues.some((i) => i.severity === "error")) // a group is sent back for its errors; its warnings ride along
        .map((g) => ({
          task: `fix_${g.task}`,
          unit: g.unit,
          tag: `${c}q${q + 1}`,
          role: FIX_ROLE[g.task],
          round: q + 1,
          body: `QA found these problems. Fix them and keep everything else as it is.\n\n${issueLines(g.issues)}\n\n${note ? `User note for this cut: ${note}\n` : ""}`,
        }));
      return run(fixes, () => ({ patch: { qaRound: q + 1 }, jobs: [] }));
    }

    case "assets": {
      if (state.castIds.length === 0) return fail("cast.json has no puppets");
      const specs: Spec[] = [
        ...state.castIds.map((id): Spec => ({
          task: "build_puppet",
          unit: id,
          tag: "r0",
        })),
        ...state.setIds.map((id): Spec => ({
          task: "build_set",
          unit: id,
          tag: "r0",
        })),
      ];
      return run(specs, () => go("voice"));
    }
    case "voice":
      return run([{ task: "voice_lines", tag: "r0" }], () => go("compile"));
    case "compile":
      return run([{ task: "compile_tracks", tag: c }], () => go("mix"));
    case "mix":
      return run([{ task: "mix_audio", tag: c }], () => go("preview"));

    case "preview": {
      const next = (): Plan =>
        meta.approvals.animatic && !meta.approved.animatic
          ? go("approve_animatic")
          : go("render");
      const shots = look(
        state.shotIds.map((id): Spec => ({
          task: "preview_shot",
          unit: id,
          tag: c,
        })),
      );
      if (shots.status === "failed") return fail(shots.error!);
      if (shots.status === "wait") return { patch: {}, jobs: shots.enqueue };
      return run([{ task: "animatic", tag: c }], next);
    }

    case "approve_animatic":
      if (meta.approved.animatic || !meta.approvals.animatic)
        return go("render");
      return meta.status === "awaiting_approval"
        ? none
        : { patch: { status: "awaiting_approval" }, jobs: [] };

    case "render":
      return run(
        state.shotIds.map((id): Spec => ({
          task: "render_shot",
          unit: id,
          tag: c,
        })),
        () => go("edit"),
      );
    case "edit":
      return run([{ task: "edit_episode", tag: c }], () => go("done"));
    default:
      return none;
  }
}
