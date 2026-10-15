import { createContext, useContext, type ReactNode } from "react";

export const ASSET_SCOPES = ["production", "campaign", "project", "brand"] as const;
export type AssetScopeName = (typeof ASSET_SCOPES)[number];

/** "production:logo.png", "brand:wordmark.svg", ... The name is the asset's stored file name. */
export type AssetRef = `${AssetScopeName}:${string}`;

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

/** Split and validate an asset reference. Throws on anything that is not a plain stored name. */
export function parseAssetRef(ref: string): { scope: AssetScopeName; name: string } {
  const separator = ref.indexOf(":");
  const scope = ref.slice(0, separator) as AssetScopeName;
  const name = ref.slice(separator + 1);
  if (separator < 0 || !ASSET_SCOPES.includes(scope)) {
    throw new Error(
      `Asset reference "${ref}" must start with one of: ${ASSET_SCOPES.map((s) => `${s}:`).join(", ")}`,
    );
  }
  if (!NAME.test(name) || name.includes("..") || name.endsWith(".asset.json")) {
    throw new Error(
      `Asset reference "${ref}" must name a stored asset file, e.g. "production:logo.png"`,
    );
  }
  return { scope, name };
}

/** Maps a validated reference to a URL. The studio and the renderer each supply one. */
export type AssetResolver = (scope: AssetScopeName, name: string) => string;

const AssetResolverContext = createContext<AssetResolver | undefined>(undefined);

export function AssetResolverProvider({
  resolve,
  children,
}: {
  resolve: AssetResolver;
  children: ReactNode;
}) {
  return <AssetResolverContext.Provider value={resolve}>{children}</AssetResolverContext.Provider>;
}

/**
 * URL for an asset in this production's scope chain. This is the only
 * supported way for a composition to reach an asset file.
 */
export function useAsset(ref: AssetRef): string {
  const resolve = useContext(AssetResolverContext);
  if (!resolve) throw new Error("useAsset() must be used inside a Motion Studio preview or render");
  const { scope, name } = parseAssetRef(ref);
  return resolve(scope, name);
}
