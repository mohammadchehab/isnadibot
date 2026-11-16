import type { ComponentPropsWithoutRef, ReactNode, Ref } from "react";

import { cn } from "../lib/utils";

/**
 * The bar a full-page surface carries above its body: 48 tall, the page's name in
 * 13/18 Medium, and a hairline under both. This is the bar the Chats and Routines
 * frames draw; the workspace header above a chat is a different, taller one.
 */
export function PageTopBar({
  title,
  titleRef,
  children,
  className,
  ...props
}: Omit<ComponentPropsWithoutRef<"header">, "title"> & {
  readonly title: string;
  /** Where focus returns when the body has nothing left to hold it. */
  readonly titleRef?: Ref<HTMLHeadingElement>;
  /** Controls that sit at the bar's end, after the title. */
  readonly children?: ReactNode;
}) {
  return (
    <header
      data-page-top-bar=""
      className={cn(
        "flex h-12 min-h-12 shrink-0 items-center gap-2 border-b border-border/60 px-5",
        className,
      )}
      {...props}
    >
      <h1
        ref={titleRef}
        tabIndex={-1}
        className="min-w-0 truncate text-13px leading-18px font-medium text-foreground outline-none"
      >
        {title}
      </h1>
      {children}
    </header>
  );
}
