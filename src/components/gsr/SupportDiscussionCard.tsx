// The opening discussion on a review: "What would help you do your job better?", asked before any
// goal or number so the meeting starts from what the person needs. It is one column on the review
// (reviews.support_discussion, 0035). The person and their admins both write it while the review is
// open; signing off freezes it with the rest of the review, so afterwards it reads as said.
import BlurInput from "../ui/BlurInput.tsx";
import Section from "../ui/Section.tsx";
import { textareaClass } from "../ui/forms.ts";

const SUPPORT_QUESTION = "What would help you do your job better?";

export default function SupportDiscussionCard({
  value,
  canWrite,
  isOwn,
  signedOff,
  onSave,
}: {
  value: string | null;
  canWrite: boolean;
  isOwn: boolean;
  signedOff: boolean;
  onSave: (next: string | null) => void;
}) {
  return (
    <Section
      eyebrow="Opening discussion"
      title={SUPPORT_QUESTION}
      description={
        signedOff
          ? "As it was discussed when this review was signed off."
          : isOwn
            ? "Start here. Write it before the meeting if you like; your manager reads it and adds to it."
            : "Asked first, before the goals. The person can write here too, so the meeting often starts from their words."
      }
    >
      {canWrite ? (
        <BlurInput
          multiline
          rows={2}
          value={value ?? ""}
          ariaLabel={SUPPORT_QUESTION}
          placeholder={isOwn ? "Tools, training, time, a process that gets in the way..." : "What the person needs to do the job better..."}
          onSave={(next) => onSave(next.trim() || null)}
          className={`${textareaClass} mt-0 min-h-[64px]`}
        />
      ) : value ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">{value}</p>
      ) : (
        <p className="text-sm text-ink-3">{signedOff ? "Nothing was raised." : "Nothing yet."}</p>
      )}
    </Section>
  );
}
