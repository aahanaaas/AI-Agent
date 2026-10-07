export const DEMO_PROFILE = {
  displayName: "Username",
  email: "username@example.com",
  phone: "+91 XXXXX XXXXX",
  passwordMask: "••••••••",
  passwordChanged: "4 Oct",
  origin: "India",
} as const;

export const initialOf = (name: string) => (name.trim()[0] ?? "?").toUpperCase();
