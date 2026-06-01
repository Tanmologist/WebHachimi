// Compatibility facade for resource animation helpers that now live in the
// project domain. New production imports should use ../project/resourceAnimation
// so editor and player modules do not depend on each other for resource logic.
export * from "../project/resourceAnimation";
