import type {
  SiteSignInFailureClass,
  SiteSignInRequestKind,
  SiteSignInRequestRecord,
  SiteSignInRequestState,
} from "@isnadi/client-runtime/browser-auth";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";

import type { SiteSignInFixtureSource } from "../../state/siteSignInFixture";

const STATES: ReadonlyArray<SiteSignInRequestState> = [
  "asking",
  "in_progress",
  "signed_in",
  "failed",
  "dismissed",
  "expired",
];

const FAILURE_CLASSES: ReadonlyArray<SiteSignInFailureClass> = [
  "in-use",
  "signed-out-meanwhile",
  "vault-disabled",
  "signed-out",
];

const KINDS: ReadonlyArray<SiteSignInRequestKind> = ["sign-in", "access"];

const NOTHING = "none";

/** A select hands back whatever string it was given; keep only the values the record accepts. */
function oneOf<T extends string>(values: ReadonlyArray<T>) {
  return (value: string | null): value is T =>
    value !== null && values.some((candidate) => candidate === value);
}

const isState = oneOf(STATES);

const isKind = oneOf(KINDS);

const isFailureClass = oneOf(FAILURE_CLASSES);

/**
 * Dev-only control over the fixture request record. It sets the record and the card re-derives,
 * so what you see here is what the seam produces; it can never render a card on its own.
 */
export function SiteSignInFixturePicker({
  record,
  source,
}: {
  readonly record: SiteSignInRequestRecord;
  readonly source: SiteSignInFixtureSource;
}) {
  const set = (patch: Parameters<SiteSignInFixtureSource["setRecord"]>[1]) =>
    source.setRecord(record.requestId, patch);

  return (
    <div
      className="mb-1 rounded-md border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-11px text-muted-foreground"
      data-testid="site-sign-in-fixture-picker"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono uppercase">fixture</span>
        <Select
          value={record.state}
          onValueChange={(value) => {
            if (isState(value)) set({ state: value });
          }}
        >
          <SelectTrigger size="compact" aria-label="Request state">
            <SelectValue>{record.state}</SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {STATES.map((state) => (
              <SelectItem key={state} value={state}>
                {state}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={record.kind}
          onValueChange={(value) => {
            if (isKind(value)) set({ kind: value });
          }}
        >
          <SelectTrigger size="compact" aria-label="Request kind">
            <SelectValue>{record.kind}</SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            {KINDS.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {kind}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Select
          value={record.failureClass ?? NOTHING}
          onValueChange={(value) => {
            set({
              failureClass: isFailureClass(value) ? value : null,
            });
          }}
        >
          <SelectTrigger size="compact" aria-label="Failure class">
            <SelectValue>{record.failureClass ?? NOTHING}</SelectValue>
          </SelectTrigger>
          <SelectPopup alignItemWithTrigger={false}>
            <SelectItem value={NOTHING}>{NOTHING}</SelectItem>
            {FAILURE_CLASSES.map((failure) => (
              <SelectItem key={failure} value={failure}>
                {failure}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {(
          [
            ["submitting", record.submitting],
            ["saved password", record.hasSavedPassword],
            ["PC routed", record.pcRouted],
          ] as const
        ).map(([label, checked]) => (
          <label key={label} className="flex items-center gap-1.5">
            <Switch
              checked={checked}
              onCheckedChange={(value) => {
                if (label === "submitting") set({ submitting: value });

                if (label === "saved password") set({ hasSavedPassword: value });

                if (label === "PC routed") set({ pcRouted: value });
              }}
            />
            {label}
          </label>
        ))}
        <Button
          size="xs"
          variant="ghost-muted"
          disabled={record.state !== "asking"}
          onClick={() => source.expireNow(record.requestId)}
        >
          Expire now
        </Button>
        <Button
          size="xs"
          variant="ghost-muted"
          onClick={() => set({ state: "asking", submitting: false, failureClass: null })}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
