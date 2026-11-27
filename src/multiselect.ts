import { $, esc } from "./utils";

export interface MultiSelectOptions {
  menuId: string;
  toggleId: string;
  cls: string;
  values: string[];
  onChange: () => void;
  limit?: number;
  headerLabel?: string;
  latestOnly?: boolean;
}

/** What createMultiSelect() returns: read or change the selection. */
export interface MultiSelect {
  values(): string[];
  set(): Set<string>;
  checkOnly(value: string | number): void;
  setValues(list: (string | number)[]): void;
  reset(): void;
}

/* =========================================================================
multiselect.ts
ONE reusable checkbox dropdown, used by all 20 filter menus (4 in each of
the 5 sections). The linked lists are managed by filterGroup.ts.

Two kinds of menu:
- plain (limit = Infinity): an "All" box + every item ticked.
- limited (limit = N): a header box ("Latest" / "All") + a x button,
  only the first N items start ticked, and ticking more than N
  un-ticks the most recently listed other item.

createMultiSelect() fills the menu, wires the checkboxes and returns a
small object to read or change the selection.
========================================================================= */

/*
options:
- menuId, toggleId - ids of the menu <div> and its button
- cls              - a class name unique to this menu's item checkboxes
- values           - the items (strings)
- onChange         - called after the user changes the selection
- limit            - max items ticked (default Infinity = plain menu)
- headerLabel      - header text of a limited menu ("Latest" or "All");
                     "" = no header row at all
- latestOnly       - header box counts as ticked only when the FIRST
                     `limit` items are the ticked ones ("Latest" behaviour)
*/
export function createMultiSelect({
    menuId,
    toggleId,
    cls,
    values,
    onChange,
    limit = Infinity,
    headerLabel = "All",
    latestOnly = false,
}: MultiSelectOptions): MultiSelect {
    const menu = $(menuId);
    const toggle = $(toggleId);
    const limited = limit !== Infinity;

    // A limited menu has a header (box + x button); with headerLabel "" it has
    // none: only an invisible box that the code below still needs
    const header = limited
        ? headerLabel
            ? `<div class="menu-head"><label><input class="ms-header" type="checkbox">${headerLabel}</label><button type="button" class="menu-clear" title="Clear selection" aria-label="Clear selection">×</button></div>`
            : `<input class="ms-header" type="checkbox" hidden>`
        : `<label class="menu-all"><input class="ms-header" type="checkbox">All</label>`;

    menu.innerHTML =
        header +
        values
            .map(
                (v, i) =>
                    `<label><input class="${cls}" type="checkbox" value="${esc(v)}"${i < limit ? " checked" : ""}>${esc(v)}</label>`,
            )
            .join("");

    const headerBox = menu.querySelector<HTMLInputElement>(".ms-header")!;
    const boxes = [...menu.querySelectorAll<HTMLInputElement>("." + cls)];
    const target = Math.min(limit, boxes.length);

    // The selection is remembered here and refreshed by sync(), so reading it
    // never has to scan the checkboxes on the page.
    let selectedValues: string[] = [];
    let selectedSet = new Set<string>();

    // Refresh the remembered selection, the header box and the button text
    function sync() {
        const picked = boxes.filter((b) => b.checked);
        const n = picked.length;
        selectedValues = picked.map((b) => b.value);
        selectedSet = new Set(selectedValues);

        if (limited) {
            headerBox.checked =
                n === target &&
                (!latestOnly || boxes.slice(0, target).every((b) => b.checked));
            headerBox.indeterminate = n > 0 && !headerBox.checked;
        } else {
            headerBox.checked = n === boxes.length && boxes.length > 0;
            headerBox.indeterminate = n > 0 && n < boxes.length;
            headerBox.disabled = boxes.length === 0;
        }

        toggle.textContent =
            n === 0
                ? "None selected ▾"
                : limit === 1
                  ? `${selectedValues[0]} ▾` // single-choice menu: show the choice
                  : n === boxes.length
                    ? "All selected ▾"
                    : `${n} selected ▾`;
    }

    function changed() {
        sync();
        onChange();
    }

    // Header box. The browser has already flipped it when this runs.
    headerBox.onclick = () => {
        if (limited) {
            const on = headerBox.checked || headerBox.indeterminate;
            boxes.forEach((b, i) => (b.checked = on && i < limit));
        } else {
            boxes.forEach((b) => (b.checked = headerBox.checked));
        }
        changed();
    };

    // The x button of a limited menu clears everything
    const clear = menu.querySelector<HTMLButtonElement>(".menu-clear");
    if (clear) {
        clear.onclick = () => {
            boxes.forEach((b) => (b.checked = false));
            changed();
        };
    }

    // Item checkboxes
    boxes.forEach((box) => {
        box.onchange = () => {
            if (limited && box.checked) {
                const chosen = boxes.filter((b) => b.checked);
                if (chosen.length > limit) {
                    const others = chosen.filter((b) => b !== box);
                    others[others.length - 1]!.checked = false;
                }
            }
            changed();
        };
    });

    sync();

    return {
        // Ticked values, in menu order (do not modify the returned array)
        values: () => selectedValues,

        // The same values, as a Set, for fast "is it selected?" checks
        set: () => selectedSet,

        // Tick only "value" (used when a bar is clicked). Does not call onChange.
        checkOnly(value: string | number) {
            boxes.forEach((b) => (b.checked = b.value === String(value)));
            sync();
        },

        // Tick exactly the items in `list` (others un-ticked). Does not call
        // onChange. Used when a menu is rebuilt and must keep the user's ticks.
        setValues(list: (string | number)[]) {
            const wanted = new Set(list.map(String));
            boxes.forEach((b) => (b.checked = wanted.has(b.value)));
            sync();
        },

        // Back to the starting selection. Does not call onChange.
        reset() {
            boxes.forEach((b, i) => (b.checked = i < limit));
            sync();
        },
    };
}
