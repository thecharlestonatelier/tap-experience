/* ==================================================================
   Practice Better → patient list  (RETIRED — do not set a key here)
   ------------------------------------------------------------------
   This function used to pull the client list from Practice Better so
   the old Card Studio could offer a dropdown of names. It is disabled,
   and the reason is not tidiness.

   Patient names are PHI. This function runs on Netlify, and Netlify has
   signed no BAA. The atelier now holds BAAs with Google and with
   Practice Better — not with Netlify — so a name must not travel this
   path, and the API key must not be set on this site. Setting
   PRACTICE_BETTER_API_KEY in Netlify would be enough to start a flow of
   patient names through a processor that has not signed.

   Practice Better now lives on Cloud Run, under the Google Cloud BAA:

     portal/lib/practicebetter.js     the only place that holds the key
     portal/server.js  /api/dose      an administration reaching the chart

   The old studio at patients/jessica/studio.html calls this. It gets a
   refusal and falls back to typing a name, which is what it already did
   whenever the key was unset — so nothing that worked stops working.
   The studio in use is portal/studio/index.html.
   ================================================================== */

export default async () => new Response(
  JSON.stringify({
    error: 'retired',
    message: 'Practice Better moved to the Cloud Run portal, which is covered ' +
             'by a BAA. Do not set an API key on this site.'
  }),
  { status: 410, headers: { 'Content-Type': 'application/json' } }
);
