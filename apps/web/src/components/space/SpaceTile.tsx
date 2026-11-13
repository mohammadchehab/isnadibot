import { Card } from "../ui/card";

/**
 * One card on a space view: a quiet heading and whatever the tile reports. Every
 * tile on the space reads the same, so a new one only picks its content.
 */
export function SpaceTile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="min-w-0 gap-2 p-4">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </Card>
  );
}
