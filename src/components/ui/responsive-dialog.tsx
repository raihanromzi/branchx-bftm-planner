"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A dialog that is a bottom sheet on mobile (below 768 px) and a centred dialog from 768 px up
 * (DESIGN.md: "Dialogs become bottom sheets on mobile"). One component, switched by CSS only, so the
 * server and client render the same markup. Flat except for its overlay shadow; radius from --radius.
 */
function ResponsiveDialog(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="responsive-dialog" {...props} />;
}

function ResponsiveDialogContent({ className, children, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
      <DialogPrimitive.Popup
        data-slot="responsive-dialog-content"
        className={cn(
          // Mobile: a sheet fixed to the bottom edge, clear of the home indicator.
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-2rem)] flex-col gap-4 overflow-y-auto rounded-t-lg border-t border-border bg-popover p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-base text-popover-foreground shadow-lg outline-none transition duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0",
          // From 768 px: a centred dialog.
          "md:inset-x-auto md:top-1/2 md:bottom-auto md:left-1/2 md:w-[calc(100%-3rem)] md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg md:border md:p-6",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

function ResponsiveDialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title className={cn("text-xl font-semibold break-words", className)} {...props} />;
}

function ResponsiveDialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return <DialogPrimitive.Description className={cn("text-base text-muted-foreground", className)} {...props} />;
}

/** The action row: stacked full width on mobile with the primary action on top, a right-aligned row from 768 px. */
function ResponsiveDialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("mt-2 flex flex-col-reverse gap-2 md:flex-row md:justify-end", className)}
      {...props}
    />
  );
}

const ResponsiveDialogClose = DialogPrimitive.Close;

export {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
};
