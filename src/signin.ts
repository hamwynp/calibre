import { $ } from "./ui";

export interface SignInDeps {
  signIn: () => Promise<void>;
  /** Called after a successful sign-in. */
  onDone: () => void;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).replace(/^SIGN_IN: /, "");

/** The "Connect Google Calendar" card: Enter or the button opens the browser to sign in. */
export function createSignIn(deps: SignInDeps): { open: (message?: string) => void; close: () => void; isOpen: () => boolean } {
  const overlay = $<HTMLDivElement>("signin");
  const msg = $<HTMLParagraphElement>("signin-msg");
  const btn = $<HTMLButtonElement>("signin-btn");
  const status = $<HTMLParagraphElement>("signin-status");
  let busy = false;

  const isOpen = () => !overlay.hidden;
  const close = () => {
    overlay.hidden = true;
  };

  async function start(): Promise<void> {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    status.classList.remove("err");
    status.textContent = "Waiting for you in the browser\u2026";
    try {
      await deps.signIn();
      close();
      deps.onDone();
    } catch (e) {
      status.classList.add("err");
      status.textContent = errText(e);
    } finally {
      busy = false;
      btn.disabled = false;
    }
  }

  function open(message?: string): void {
    msg.textContent = message ? errText(message) : "calibre needs access to your Google Calendar. Your browser will open so you can approve it.";
    status.textContent = "";
    status.classList.remove("err");
    overlay.hidden = false;
    btn.focus();
  }

  btn.addEventListener("click", () => void start());
  overlay.addEventListener("keydown", (e) => {
    if (e.ctrlKey && (e.key === "/" || e.key === "?")) return;
    if (e.key === "Escape") close();
    else if (e.key === "Enter") void start();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });

  return { open, close, isOpen };
}
