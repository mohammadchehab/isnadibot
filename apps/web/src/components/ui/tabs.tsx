"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";

const tabsListVariants = cva("flex shrink-0 items-center gap-1", {
  defaultVariants: {
    variant: "default",
  },
  variants: {
    variant: {
      // Sits in a top bar that already draws its own border and padding.
      "top-bar": "h-full",
      default: "border-b border-border px-3",
    },
  },
});

const tabsTabVariants = cva(
  "-mb-px inline-flex h-9 cursor-pointer items-center border-b-2 border-transparent px-2.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:border-foreground data-active:text-foreground",
  {
    defaultVariants: {
      variant: "default",
    },
    variants: {
      variant: {
        "top-bar": "h-full",
        default: "",
      },
    },
  },
);

function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col", className)}
      data-slot="tabs"
      {...props}
    />
  );
}

function TabsList({
  className,
  variant,
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      className={cn(tabsListVariants({ variant }), className)}
      data-slot="tabs-list"
      {...props}
    />
  );
}

function TabsTab({
  className,
  variant,
  ...props
}: TabsPrimitive.Tab.Props & VariantProps<typeof tabsTabVariants>) {
  return (
    <TabsPrimitive.Tab
      className={cn(tabsTabVariants({ variant }), className)}
      data-slot="tabs-tab"
      {...props}
    />
  );
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      className={cn("flex min-h-0 min-w-0 flex-1 flex-col outline-none", className)}
      data-slot="tabs-panel"
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsPanel, TabsTab };
