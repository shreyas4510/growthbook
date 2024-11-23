import Cookies from "js-cookie";
import { AppProps } from "next/app";
import "@/styles/global.scss";
import "@/styles/global-radix-overrides.scss";
import "@radix-ui/themes/styles.css";
import "@/styles/theme-config.css";
import Head from "next/head";
import { useEffect, useState } from "react";
import {
  Context,
  GrowthBook,
  GrowthBookProvider,
  BrowserCookieStickyBucketService,
} from "@growthbook/growthbook-react";
import { Inter } from "next/font/google";
import { OrganizationMessagesContainer } from "@/components/OrganizationMessages/OrganizationMessages";
import { DemoDataSourceGlobalBannerContainer } from "@/components/DemoDataSourceGlobalBanner/DemoDataSourceGlobalBanner";
import { PageHeadProvider } from "@/components/Layout/PageHead";
import { RadixTheme } from "@/services/RadixTheme";
import {AuthProvider, useAuth} from "@/services/auth";
import ProtectedPage from "@/components/ProtectedPage";
import {
  DefinitionsGuard,
  DefinitionsProvider,
} from "@/services/DefinitionsContext";
import track from "@/services/track";
import { initEnv, isTelemetryEnabled } from "@/services/env";
import LoadingOverlay from "@/components/LoadingOverlay";
import "diff2html/bundles/css/diff2html.min.css";
import Layout from "@/components/Layout/Layout";
import { AppearanceUIThemeProvider } from "@/services/AppearanceUIThemeProvider";
import TopNavLite from "@/components/Layout/TopNavLite";
import { AppFeatures } from "@/./types/app-features";
import GetStartedProvider from "@/services/GetStartedProvider";
import GuidedGetStartedBar from "@/components/Layout/GuidedGetStartedBar";
import LayoutLite from "@/components/Layout/LayoutLite";
import { GB_SDK_ID } from "@/services/utils";
import {UserContextProvider} from "@/services/UserContext";

// If loading a variable font, you don't need to specify the font weight
const inter = Inter({ subsets: ["latin"] });

type ModAppProps = AppProps & {
  Component: {
    envReady?: boolean;
    noOrganization?: boolean;
    liteLayout?: boolean;
    preAuth?: boolean;
    preAuthTopNav?: boolean;
    progressiveAuth?: boolean;
    progressiveAuthTopNav?: boolean;
    noLoadingOverlay?: boolean;
  };
};

const gbContext: Context = {
  apiHost: "https://cdn.growthbook.io",
  clientKey: GB_SDK_ID,
  enableDevMode: true,
  trackingCallback: (experiment, result) => {
    track("Experiment Viewed", {
      experimentId: experiment.key,
      variationId: result.variationId,
    });
  },
  stickyBucketService: new BrowserCookieStickyBucketService({
    jsCookie: Cookies,
  }),
};
export const growthbook = new GrowthBook<AppFeatures>(gbContext);

function App({
  Component,
  pageProps,
  router,
}: ModAppProps): React.ReactElement {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  // hacky:
  const parts = router.route.substr(1).split("/");

  const organizationRequired = !Component.noOrganization;
  const preAuth = Component.preAuth || false;
  const progressiveAuth = Component.progressiveAuth || false;
  const preAuthTopNav = Component.preAuthTopNav || false;
  const progressiveAuthTopNav = Component.progressiveAuthTopNav || false;
  const liteLayout = Component.liteLayout || false;
  const noLoadingOverlay = Component.noLoadingOverlay || false;

  const { orgId } = useAuth();

  useEffect(() => {
    initEnv()
      .then(() => {
        setReady(true);
      })
      .catch((e) => {
        setError(e.message);
        console.error(e.message);
      });
  }, []);

  useEffect(() => {
    if (!ready) return;
    if (isTelemetryEnabled()) {
      let _rtQueue: { key: string; on: boolean }[] = [];
      let _rtTimer = 0;
      gbContext.onFeatureUsage = (key, res) => {
        _rtQueue.push({
          key,
          on: res.on,
        });
        if (!_rtTimer) {
          _rtTimer = window.setTimeout(() => {
            // Reset the queue
            _rtTimer = 0;
            const q = [_rtQueue];
            _rtQueue = [];

            window
              .fetch(
                `https://rt.growthbook.io/?key=key_prod_cb40dfcb0eb98e44&events=${encodeURIComponent(
                  JSON.stringify(q)
                )}`,

                {
                  cache: "no-cache",
                  mode: "no-cors",
                }
              )
              .catch(() => {
                // TODO: retry in case of network errors?
              });
          }, 2000);
        }
      };
    }
    track("App Load");
  }, [ready]);

  useEffect(() => {
    // Load feature definitions JSON from GrowthBook API
    growthbook.init({ streaming: true }).catch(() => {
      console.log("Failed to fetch GrowthBook feature definitions");
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    growthbook.setURL(window.location.href);
    track("page-load", {
      pathName: router.pathname,
    });
  }, [ready, router.pathname]);

  const renderPreAuth = () => {
    if (!ready || !progressiveAuth) {
      return (
        <PageHeadProvider>
          {preAuthTopNav ? (
            <>
              <TopNavLite/>
              <main className="container mt-5">
                <Component {...{...pageProps, envReady: ready}} />
              </main>
            </>
          ) : (
            <Component {...{...pageProps, envReady: ready }} />
          )}
        </PageHeadProvider>
      );
    }

    return (
      <AuthProvider exitOnNoAuth={!(preAuth || progressiveAuth)}>
        <GrowthBookProvider growthbook={growthbook}>
          <UserContextProvider key={orgId}>
            <DefinitionsProvider>
              <PageHeadProvider>
                {preAuthTopNav || progressiveAuthTopNav ? (
                  <>
                    <TopNavLite/>
                    <main className="container mt-5">
                      <Component {...{...pageProps, envReady: ready}} />
                    </main>
                  </>
                ) : (
                  <Component {...{...pageProps, envReady: ready }} />
                )}
              </PageHeadProvider>
            </DefinitionsProvider>
          </UserContextProvider>
        </GrowthBookProvider>
      </AuthProvider>
    );
  };

  return (
    <>
      <style jsx global>{`
        html {
          font-family: var(--default-font-family);
          --default-font-family: ${inter.style.fontFamily};
        }
        body {
          font-family: var(--default-font-family);
        }
        .radix-themes {
          --default-font-family: ${inter.style.fontFamily};
        }
      `}</style>
      <Head>
        <title>GrowthBook</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {ready || noLoadingOverlay ? (
        <AppearanceUIThemeProvider>
          <RadixTheme>
            <div id="portal-root" />
            {preAuth || progressiveAuth ? (
              renderPreAuth()
            ) : (
              <PageHeadProvider>
                <AuthProvider>
                  <GrowthBookProvider growthbook={growthbook}>
                    <ProtectedPage organizationRequired={organizationRequired}>
                      {organizationRequired ? (
                        <GetStartedProvider>
                          <DefinitionsProvider>
                            {liteLayout ? <LayoutLite /> : <Layout />}
                            <main className={`main ${parts[0]}`}>
                              <GuidedGetStartedBar />
                              <OrganizationMessagesContainer />
                              <DemoDataSourceGlobalBannerContainer />
                              <DefinitionsGuard>
                                <Component {...{ ...pageProps, envReady: ready }} />
                              </DefinitionsGuard>
                            </main>
                          </DefinitionsProvider>
                        </GetStartedProvider>
                      ) : (
                        <div>
                          <TopNavLite />
                          <main className="container mt-5">
                            <Component {...{ ...pageProps, envReady: ready }} />
                          </main>
                        </div>
                      )}
                    </ProtectedPage>
                  </GrowthBookProvider>
                </AuthProvider>
              </PageHeadProvider>
            )}
          </RadixTheme>
        </AppearanceUIThemeProvider>
      ) : error ? (
        <div className="container mt-3">
          <div className="alert alert-danger">
            Error Initializing GrowthBook: {error}
          </div>
        </div>
      ) : (
        <LoadingOverlay />
      )}
    </>
  );
}

export default App;
