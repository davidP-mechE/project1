"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function GoogleButton() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      className="w-full"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await authClient.signIn.social({ provider: "google", callbackURL: "/library", errorCallbackURL: "/login" });
        setBusy(false);
      }}
    >
      <svg aria-hidden viewBox="0 0 24 24" className="size-4">
        <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
      </svg>
      Continue with Google
    </Button>
  );
}

export function OrDivider() {
  return (
    <div className="my-5 flex items-center gap-3 text-xs text-muted" aria-hidden>
      <span className="h-px flex-1 bg-border" /> or <span className="h-px flex-1 bg-border" />
    </div>
  );
}
