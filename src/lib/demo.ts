/** Demo accounts made by `npm run seed:demo` (invented people). Never in production. */
export const DEMO_DOMAIN = "demo.example.com";
export const DEMO_PASSWORD = "coursebook-demo-2026";
export const DEMO_ACCOUNTS = [
  { role: "Program admin", email: `admin@${DEMO_DOMAIN}` },
  { role: "Teacher", email: `teacher@${DEMO_DOMAIN}` },
  { role: "Math specialist", email: `specialist@${DEMO_DOMAIN}` },
  { role: "Student", email: `student@${DEMO_DOMAIN}` },
] as const;
