"use client";

import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeNext } from "@/lib/safe-next";
import { cn } from "@/lib/utils";

// Copy from docs/design/E0-S5.md. The 401 and 429 texts match the sign-in endpoint's messages (api.md).
export const SIGN_IN_COPY = {
  invalidCredentials: "Email atau kata sandi salah.",
  lockedOut: "Terlalu banyak percobaan. Coba lagi dalam 15 menit.",
  network: "Tidak bisa terhubung. Periksa koneksi, lalu coba lagi.",
  emailRequired: "Email wajib diisi",
  passwordRequired: "Kata sandi wajib diisi",
} as const;

type FieldErrors = { email?: string; password?: string };
type FormAlert = { message: string; id: number };

const inputClass =
  "h-12 px-3 text-base md:text-base focus-visible:ring-0 focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring read-only:cursor-progress";

/**
 * The sign-in form: POST /api/auth/sign-in, then on to the page asked for. `next` is the raw query value;
 * safeNext() decides where to go, so a `next` that is not a same-site path ends on the dashboard (EC39).
 */
export function SignInForm({ next }: { next?: string }) {
  const router = useRouter();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [alert, setAlert] = useState<FormAlert | null>(null);

  function showAlert(message: string) {
    // A new id re-mounts the alert, so a repeated message is announced again.
    setAlert((previous) => ({ message, id: (previous?.id ?? 0) + 1 }));
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const errors: FieldErrors = {};
    if (!email.trim()) errors.email = SIGN_IN_COPY.emailRequired;
    if (!password) errors.password = SIGN_IN_COPY.passwordRequired;
    setFieldErrors(errors);
    if (errors.email || errors.password) {
      setAlert(null);
      (errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setPending(true);
    setAlert(null);
    let response: Response;
    try {
      response = await fetch("/api/auth/sign-in", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      // No response at all: keep both fields so the Admin can simply try again.
      setPending(false);
      showAlert(SIGN_IN_COPY.network);
      return;
    }

    if (response.ok) {
      // Stay pending while the next page loads; the refresh drops any cached signed-out screen.
      router.replace(safeNext(next));
      router.refresh();
      return;
    }

    setPending(false);
    const body = await readError(response);
    if (response.status === 401) {
      setPassword("");
      showAlert(SIGN_IN_COPY.invalidCredentials);
      passwordRef.current?.focus();
    } else if (response.status === 429) {
      showAlert(SIGN_IN_COPY.lockedOut);
    } else if (response.status === 400 && body?.fields) {
      setFieldErrors({ email: body.fields.email, password: body.fields.password });
      (body.fields.email ? emailRef : passwordRef).current?.focus();
    } else {
      showAlert(body?.message ?? SIGN_IN_COPY.network);
    }
  }

  return (
    <form noValidate onSubmit={onSubmit} aria-busy={pending} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor="email" className="text-base leading-6">
          Email
        </Label>
        <Input
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          readOnly={pending}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? "email-error" : undefined}
          className={inputClass}
        />
        {fieldErrors.email && <FieldError id="email-error">{fieldErrors.email}</FieldError>}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password" className="text-base leading-6">
          Kata sandi
        </Label>
        <div className="relative">
          <Input
            ref={passwordRef}
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            autoCapitalize="none"
            spellCheck={false}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            readOnly={pending}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? "password-error" : undefined}
            className={cn(inputClass, "pr-12")}
          />
          <button
            type="button"
            onClick={() => setShowPassword((shown) => !shown)}
            aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
            aria-controls="password"
            className="absolute inset-y-0 right-0.5 my-auto flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {showPassword ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
          </button>
        </div>
        {fieldErrors.password && <FieldError id="password-error">{fieldErrors.password}</FieldError>}
      </div>

      {alert && (
        <Alert
          key={alert.id}
          variant="destructive"
          className="border-danger/40 px-3 py-2.5 text-base text-danger *:[svg]:size-5 *:[svg]:translate-y-0.5"
        >
          <CircleAlert aria-hidden />
          <p>{alert.message}</p>
        </Alert>
      )}

      <Button type="submit" disabled={pending} className="mt-1 h-12 w-full text-base focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-progress">
        {pending ? "Memproses…" : "Masuk"}
      </Button>
    </form>
  );
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-sm text-danger">
      {children}
    </p>
  );
}

type ErrorBody = { code?: string; message?: string; fields?: Record<string, string | undefined> };

async function readError(response: Response): Promise<ErrorBody | null> {
  try {
    const body = (await response.json()) as { error?: ErrorBody };
    return body.error ?? null;
  } catch {
    return null;
  }
}
