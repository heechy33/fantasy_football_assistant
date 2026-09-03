/** Short, in-context instructions for finding a Sleeper draft id without leaving the Draft Room. */
export function SleeperDraftIdGuide() {
  return (
    <>
      <p className='muted'>
        In Sleeper, open the draft you want to track and use <strong>Share Draftboard</strong>.
      </p>
      <ol className='provider-card-steps'>
        <li>Open your Sleeper draft page.</li>
        <li>Click <strong>Share Draftboard</strong>.</li>
        <li>Copy the link, return here, and paste it under <strong>Start draft</strong>. We’ll pull out the draft ID automatically.</li>
      </ol>
      <p className='muted'>You can also paste the draft ID by itself if you already have it.</p>
    </>
  );
}
