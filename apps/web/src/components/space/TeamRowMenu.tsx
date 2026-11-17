import { ArchiveIcon, MessageSquareIcon, MoreHorizontalIcon, PauseIcon } from "lucide-react";

import { useI18n } from "../../i18n";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { buildTeamRowMenu, type TeamRowMenuBot } from "./teamRowMenu.logic";

/**
 * The row menu behind every team row's ellipsis (E13b `2546:3758`). The frame's
 * menu is 232 wide over three 32px entries, which the primitive already draws;
 * only the width is set here, so nothing is restyled to match.
 *
 * Which entries a row offers is decided by {@link buildTeamRowMenu}, so the menu
 * never draws one that would do nothing.
 */
export function TeamRowMenu({
  bot,
  onSteer,
  onInterrupt,
  onArchive,
}: {
  readonly bot: TeamRowMenuBot;
  readonly onSteer: () => void;
  readonly onInterrupt: () => void;
  readonly onArchive: () => void;
}) {
  const { t } = useI18n();

  const items = buildTeamRowMenu({
    bot,
    t,
    icons: {
      steer: <MessageSquareIcon aria-hidden />,
      interrupt: <PauseIcon aria-hidden />,
      archive: <ArchiveIcon aria-hidden />,
    },
    onSteer,
    onInterrupt,
    onArchive,
  });

  return (
    <Menu>
      <MenuTrigger
        render={
          // A row with nothing to offer — an idle boss, which has no turn to steer or
          // interrupt and no archive — keeps the frame's trigger but cannot open an
          // empty popup (designer D1).
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("Bot actions")}
            disabled={items.length === 0}
          >
            <MoreHorizontalIcon aria-hidden />
          </Button>
        }
      />
      <MenuPopup align="end" className="w-58">
        {items.map((item) => (
          <MenuItem key={item.id} variant={item.variant} onClick={item.run}>
            {item.icon}
            {item.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
