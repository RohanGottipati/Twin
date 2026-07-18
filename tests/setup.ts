import "@testing-library/jest-dom/vitest";

// Unit tests must stay offline on TypeScript fixtures, never require Atlas.
process.env.TWINTO_REPOSITORY_PROVIDER = "fixture";
delete process.env.MONGODB_URI;
