import {
  VolumeProductionStateStore,
  type VolumeChapterProductionRecordV1,
  type VolumeManualReviewDecision,
} from "./volume-production-state.js";

export type VolumeStateStoreForReview = Pick<
  VolumeProductionStateStore,
  "recordManualReview" | "releaseEligible"
>;

export interface VolumeProductionReviewServiceOptions {
  readonly projectRoot: string;
  readonly stateStore?: VolumeStateStoreForReview;
}

export interface VolumeManualReviewInput {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly runId: string;
  readonly decision: VolumeManualReviewDecision;
  readonly note?: string;
}

/**
 * Commercial manual review API (FR-B08/FR-B09). Writes only
 * commercial/volume-production-state.json through the protected
 * recordManualReview transition. It never calls the existing InkOS
 * review commands, never touches the story-side chapter metadata
 * status, and never rolls back story state.
 */
export class VolumeProductionReviewService {
  private readonly stateStore: VolumeStateStoreForReview;

  constructor(options: VolumeProductionReviewServiceOptions) {
    this.stateStore = options.stateStore ?? new VolumeProductionStateStore(options.projectRoot);
  }

  async reviewChapter(input: VolumeManualReviewInput): Promise<VolumeChapterProductionRecordV1> {
    const state = await this.stateStore.recordManualReview({
      bookId: input.bookId,
      chapterNumber: input.chapterNumber,
      runId: input.runId,
      decision: input.decision,
      ...(input.note !== undefined ? { note: input.note } : {}),
    });
    const record = state.chapters[String(input.chapterNumber)];
    if (!record) {
      // recordManualReview validated the chapter exists; this is unreachable
      // but keeps the return type honest without a non-null assertion.
      throw new Error("Manual review did not produce a chapter record for chapter " + String(input.chapterNumber));
    }
    return record;
  }

  async releaseEligible(bookId: string, chapterNumber: number): Promise<boolean> {
    return this.stateStore.releaseEligible(bookId, chapterNumber);
  }
}
