export type NavLink = {
  label: string;
  href: string;
  external?: boolean;
};

export type NavGroup = {
  label: string;
  links: NavLink[];
};

export type NavConfig = {
  primary: NavLink[];
  groups: NavGroup[];
};

export const NAV_CONFIG: NavConfig = {
  primary: [
    { label: "Home", href: "/" },
    { label: "Campaigns", href: "/campaigns" },
    { label: "Prospects", href: "/prospects" },
    { label: "Pipeline", href: "/pipeline" },
  ],
  groups: [
    {
      label: "Outreach",
      links: [
        { label: "Replies", href: "/replies" },
        { label: "Meetings", href: "/meetings" },
        { label: "Suppressions", href: "/suppressions" },
      ],
    },
    {
      label: "Admin",
      links: [{ label: "Deliverability", href: "/admin/deliverability" }],
    },
  ],
};
