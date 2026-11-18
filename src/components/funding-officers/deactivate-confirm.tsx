"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { FO_COPY, type FundingOfficer, InlineAlert } from "./shared";

export type DeactivateConfirmProps = {
  open: boolean;
  /** The Funding Officer to deactivate. Kept while the confirm closes, so it does not empty mid-animation. */
  officer: FundingOfficer | null;
  pending: boolean;
  /** A failure from the last attempt. `reload` adds "Muat ulang" (EC18). */
  error: { message: string; reload: boolean } | null;
  onConfirm: () => void;
  onReload: () => void;
  onClose: () => void;
  /**
   * Extra content under the consequence sentence. E1-S4 puts the Funding Officer's open work here
   * ("4 Prospect, 2 Pipeline, 3 Kegiatan mendatang masih atas nama Rina.").
   */
  children?: ReactNode;
};

/** "Nonaktifkan Rina Kartika? Ia tidak bisa ditugaskan pekerjaan baru." (docs/design/E1-S2.md). */
export function DeactivateConfirm({ open, officer, pending, error, onConfirm, onReload, onClose, children }: DeactivateConfirmProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => !next && onClose()}>
      <ResponsiveDialogContent>
        {officer && (
          <>
            <ResponsiveDialogTitle>{FO_COPY.deactivateQuestion(officer.name)}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-foreground">{FO_COPY.deactivateConsequence}</ResponsiveDialogDescription>
            {children}
            {error && (
              <InlineAlert
                message={error.message}
                action={
                  error.reload && (
                    <Button type="button" variant="outline" onClick={onReload} className="h-11 px-4 text-base lg:h-9 lg:text-sm">
                      {FO_COPY.reload}
                    </Button>
                  )
                }
              />
            )}
            <ResponsiveDialogFooter>
              <ResponsiveDialogClose
                render={<Button type="button" variant="outline" className="h-11 px-4 text-base lg:h-9 lg:text-sm" />}
              >
                {FO_COPY.cancel}
              </ResponsiveDialogClose>
              <Button
                type="button"
                variant="destructive"
                onClick={onConfirm}
                disabled={pending}
                className="h-11 px-4 text-base disabled:cursor-progress lg:h-9 lg:text-sm"
              >
                {FO_COPY.deactivate}
              </Button>
            </ResponsiveDialogFooter>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
