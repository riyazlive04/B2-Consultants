import Script from "next/script";

/**
 * Meta Pixel and GA, injected per site.
 *
 * You are replacing a system whose entire job is ad conversion. The pixel is not optional: without
 * it Meta cannot attribute a lead back to the ad that produced it, cannot build lookalikes, and
 * cannot optimise delivery - so the rebuilt site would spend the same budget worse.
 *
 * ── Two deliberate choices ────────────────────────────────────────────────────────────────────
 * 1. Renders NOTHING when unset. An empty pixel id would emit a script that calls fbq('init', '')
 *    and throws on every page load. Absent means absent.
 * 2. `afterInteractive`, not `beforeInteractive`. These pages are cached and static; making the
 *    visitor wait on a third-party script before the page is usable would trade the very speed
 *    this route was designed for. Analytics that loads a moment later still counts the visit.
 *
 * The ids are non-secret by nature - they ship in the HTML of every site that uses them - so
 * holding them on the Site row rather than in env is correct: different sites, different pixels,
 * edited by the team without a deploy.
 */

/** Meta pixel ids are numeric; GA4 is "G-XXXXXXX". Validated because these values are interpolated
 *  into a script body, and a a quote in the wrong place there is script injection, not a typo. */
const META_ID = /^[0-9]{6,20}$/;
const GA_ID = /^G-[A-Z0-9]{4,20}$/i;

export default function SiteTracking({
  metaPixelId,
  gaMeasurementId,
}: {
  metaPixelId?: string | null;
  gaMeasurementId?: string | null;
}) {
  const meta = metaPixelId && META_ID.test(metaPixelId.trim()) ? metaPixelId.trim() : null;
  const ga = gaMeasurementId && GA_ID.test(gaMeasurementId.trim()) ? gaMeasurementId.trim() : null;

  if (!meta && !ga) return null;

  return (
    <>
      {meta && (
        <>
          <Script id="meta-pixel" strategy="afterInteractive">
            {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${meta}');fbq('track','PageView');`}
          </Script>
          {/* The <noscript> beacon is what counts visitors with JS disabled or blocked. Meta's own
              install snippet includes it; omitting it quietly undercounts. */}
          <noscript>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              height="1"
              width="1"
              style={{ display: "none" }}
              alt=""
              src={`https://www.facebook.com/tr?id=${meta}&ev=PageView&noscript=1`}
            />
          </noscript>
        </>
      )}

      {ga && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga}`} strategy="afterInteractive" />
          <Script id="ga4" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];
function gtag(){dataLayer.push(arguments);}
gtag('js',new Date());
gtag('config','${ga}');`}
          </Script>
        </>
      )}
    </>
  );
}
