"use client"

import { CircleCheck, CircleAlert } from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// The shadcn Sonner toaster, without next-themes: the app follows the system colour scheme (globals.css),
// so the toaster does too. Colours come from the design tokens.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      icons={{
        success: <CircleCheck className="size-5 text-success" aria-hidden />,
        error: <CircleAlert className="size-5 text-danger" aria-hidden />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{ classNames: { toast: "text-base font-sans", title: "text-base font-medium" } }}
      {...props}
    />
  )
}

export { Toaster }
