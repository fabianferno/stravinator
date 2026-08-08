"use client";

import { useState } from "react";
import { Button } from "@/components/Button";

export interface InviteFormProps {
  /** Where "Connect Strava" sends the athlete. Wire to the OAuth start route. */
  connectHref: string;
  /** Set once the invite code has already been accepted for this browser. */
  alreadyInvited?: boolean;
}

export function InviteForm({ connectHref, alreadyInvited = false }: InviteFormProps) {
  const [code, setCode] = useState("");
  const ready = alreadyInvited || code.trim().length > 0;

  return (
    <form
      className="dock"
      action={connectHref}
      method="get"
      aria-labelledby="invite-heading"
      onSubmit={(e) => {
        if (!ready) e.preventDefault();
      }}
    >
      <h2 className="sr-only" id="invite-heading">
        Join the beta
      </h2>
      {alreadyInvited ? null : (
        <>
          <label className="sr-only" htmlFor="invite-code">
            Invite code
          </label>
          <input
            className="field"
            id="invite-code"
            name="invite"
            placeholder="Invite code"
            autoComplete="one-time-code"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </>
      )}
      <Button type="submit" variant="primary" disabled={!ready}>
        Connect Strava
      </Button>
    </form>
  );
}
