/* ==================================================================
   Practice Better → patient list  (RETIRED — do not set a key here)
   ------------------------------------------------------------------
   This function used to pull the client list from Practice Better so
   the old Card Studio could offer a dropdown of names. It is disabled,
   and the reason is not tidiness.

   Patient names are PHI. This function runs on Netlify, and Netlify has
   signed no BAA — the atelier's BAA is with Google — so a name must not
   travel this path, and no Practice Better key may be set on this site.
   Setting PRACTICE_BETTER_API_KEY here would be enough to start a flow of
   patient names through a processor that has not signed.

   Nothing calls Practice Better any more. Names live on the card records
   in Firestore, and doses in the administrations collection, both on
   Cloud Run under the Google Cloud BAA:

     portal/store/index.js            the card records
     portal/store/doses.js            what was injected, and when
     portal/server.js  /api/dose      a tapped vial label recording a dose

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
