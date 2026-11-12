'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';

import { cn } from '@/lib/utils';

// shadcn/ui's Base UI dialog composition, styled with Gloaming's existing surfaces.
const Dialog = DialogPrimitive.Root;
const DialogClose = DialogPrimitive.Close;
const DialogTitle = DialogPrimitive.Title;
const DialogDescription = DialogPrimitive.Description;

function DialogContent({ className, ...props }: DialogPrimitive.Popup.Props) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="dialog-overlay"
        className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[2px] transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0"
      />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-xl bg-card text-foreground shadow-card ring-1 ring-border/50 outline-none',
          className,
        )}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle };
