import React from "react";

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // RBAC and Authentication are now strictly enforced natively at the Edge via middleware.ts.
  // This layout acts purely as a structural wrapper, ensuring zero flash-of-unauthorized-content.
  return <>{children}</>;
}