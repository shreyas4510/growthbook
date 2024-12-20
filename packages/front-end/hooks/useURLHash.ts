import { useEffect, useState } from "react";

/**
 * Hook to sync a component's state with the URL hash
 *
 * @param validIds - Array of valid hash values that this component can handle
 * @returns [currentHash, setHash] - Current hash value and function to update it
 *
 * @example
 * ```tsx
 * const tabs = ['info', 'settings', 'advanced'] as const;
 * const [activeTab, setActiveTab] = useURLHash(tabs);
 *
 * // activeTab will automatically update when URL hash changes
 * // setActiveTab will update both state and URL hash
 * return (
 *   <Tabs active={activeTab} onChange={setActiveTab}>
 *     <Tab id="info">Info</Tab>
 *     <Tab id="settings">Settings</Tab>
 *     <Tab id="advanced">Advanced</Tab>
 *   </Tabs>
 * );
 * ```
 */
export default function useURLHash<Id extends string>(validIds: Id[]) {
  const [hash, setHashState] = useState(() => {
    // Get initial hash from URL, defaulting to first valid slug
    const urlHash = window.location.hash.slice(1);
    return validIds.includes(urlHash as Id) ? urlHash : undefined;
  });

  const setHashAndURL = (newHash: Id) => {
    if (validIds.includes(newHash)) {
      window.location.hash = newHash;
    }
  };

  // Listen for URL changes
  useEffect(() => {
    const handler = () => {
      const newHash = window.location.hash.slice(1);
      if (validIds.includes(newHash as Id)) {
        setHashState(newHash);
      }
    };

    window.addEventListener("hashchange", handler, false);
    return () => window.removeEventListener("hashchange", handler, false);
  }, [validIds]);

  return [hash, setHashAndURL] as const;
}
