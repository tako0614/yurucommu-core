import { defineConfig } from "vitepress";

const rootNav = [
  { text: "Overview", link: "/" },
  {
    text: "ActivityPub",
    items: [{ text: "Spec", link: "/activitypub" }]
  },
  {
    text: "takos-private",
    items: [{ text: "Tenant Provisioning", link: "/tenant-api" }]
  }
];

const rootSidebar = {
  "/": [
    {
      text: "docs.takos.jp",
      items: [{ text: "Overview", link: "/" }]
    },
    {
      text: "ActivityPub",
      items: [{ text: "ActivityPub Spec", link: "/activitypub" }]
    },
    {
      text: "takos-private",
      items: [{ text: "Tenant Provisioning", link: "/tenant-api" }]
    }
  ]
};

const jaNav = [
  { text: "概要", link: "/ja/" },
  {
    text: "ActivityPub",
    items: [{ text: "仕様", link: "/ja/activitypub" }]
  },
  {
    text: "takos-private",
    items: [{ text: "テナント提供", link: "/ja/tenant-api" }]
  }
];

const jaSidebar = {
  "/ja/": [
    {
      text: "docs.takos.jp",
      items: [{ text: "概要", link: "/ja/" }]
    },
    {
      text: "ActivityPub",
      items: [{ text: "仕様", link: "/ja/activitypub" }]
    },
    {
      text: "takos-private",
      items: [{ text: "テナント提供", link: "/ja/tenant-api" }]
    }
  ]
};

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Takos Docs",
  description:
    "Public reference for Takos ActivityPub extensions and takos-private tenant provisioning",
  locales: {
    root: {
      label: "English",
      lang: "en-US"
    },
    ja: {
      label: "日本語",
      lang: "ja-JP",
      link: "/ja/"
    }
  },
  themeConfig: {
    socialLinks: [{ icon: "github", link: "https://github.com/takos-dev" }],
    nav: rootNav,
    sidebar: rootSidebar,
    locales: {
      ja: {
        nav: jaNav,
        sidebar: jaSidebar
      }
    }
  }
});
