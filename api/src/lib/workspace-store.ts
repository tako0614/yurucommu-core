import type { AppWorkspaceManifest } from "./app-preview";

const demoWorkspace: AppWorkspaceManifest = {
  id: "ws_demo",
  name: "Demo Workspace",
  views: {
    screens: [
      {
        id: "screen.home",
        route: "/",
        title: "Home",
        layout: {
          type: "Column",
          props: { id: "root", gap: 12 },
          children: [
            {
              type: "Row",
              props: { id: "header", slot: "header", gap: 8, align: "center" },
              children: [
                { type: "Text", props: { text: "Home", variant: "title" } },
                { type: "Spacer", props: { flex: 1 } },
              ],
            },
            {
              type: "Row",
              props: { id: "content", gap: 12 },
              children: [
                {
                  type: "Column",
                  props: { id: "main", slot: "main", flex: 2 },
                  children: [{ type: "Placeholder", props: { text: "Timeline" } }],
                },
                {
                  type: "Column",
                  props: { id: "right-sidebar", slot: "right-sidebar", flex: 1, gap: 8 },
                  children: [{ type: "Placeholder", props: { text: "Sidebar" } }],
                },
              ],
            },
          ],
        },
      },
    ],
    insert: [
      {
        screen: "screen.home",
        position: "right-sidebar",
        order: 10,
        node: {
          type: "Card",
          props: { title: "Notes" },
          children: [
            {
              type: "Text",
              props: { text: "Workspace inserts render into layout slots." },
            },
          ],
        },
      },
      {
        screen: "screen.home",
        position: "header",
        order: 5,
        node: {
          type: "Button",
          props: {
            action: "action.open_composer",
            label: "Compose",
            emphasis: "primary",
          },
        },
      },
    ],
  },
};

const defaultWorkspaceIds = new Set(["default", "demo", "ws_demo"]);

export async function loadWorkspaceManifest(
  workspaceId: string,
): Promise<AppWorkspaceManifest | null> {
  if (defaultWorkspaceIds.has(workspaceId)) {
    return demoWorkspace;
  }
  return null;
}

export function getDemoWorkspace(): AppWorkspaceManifest {
  return demoWorkspace;
}
