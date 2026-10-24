import { LegalLayout, Section, Table } from "./LegalLayout";

export default function CookiesPage() {
  return (
    <LegalLayout
      title="Cookies and browser storage"
      intro={
        <p>
          Convolve sets no cookies and uses no analytics, advertising or tracking technologies. The website only keeps
          what it needs to work in your browser&apos;s local and session storage, so there is no consent banner.
        </p>
      }
    >
      <Section id="storage" title="What is stored in your browser">
        <Table
          head={["Name", "Type", "Purpose", "Duration"]}
          rows={[
            ["convolve-auth", "Local storage", "Keeps you signed in (session and refresh token)", "Until you sign out or the session ends"],
            ["convolve-auth-code-verifier", "Local storage", "One-time code that completes sign-in with Google", "Removed when sign-in completes"],
            ["convolve_runs", "Local storage", "Remembers your active and recent research runs in the workspace", "Until cleared"],
            ["convolve_paper_wallet_usd", "Local storage", "Size of your simulated paper wallet shown in the workspace", "Until cleared"],
            ["convolve_profile_name, convolve_profile_email", "Local storage", "Display name and email shown in the workspace interface", "Until cleared"],
            ["convolve-pending-terms", "Session storage", "Carries your acceptance of the Terms through sign-up with Google until it is recorded", "Until the tab is closed"],
            ["convolve_dismissed_runs", "Session storage", "Run notifications you have dismissed", "Until the tab is closed"],
            ["convolve:tour-spot", "Session storage", "Which control the guided tour is pointing at, so a reload resumes in place", "Until the tab is closed or the tour ends"],
          ]}
        />
        <p>
          These items are strictly necessary to provide the workspace you requested. They are not shared with third
          parties and are not used to track you across websites. Your tour progress and Terms acceptance are also stored
          with your account on our servers, as described in the <a href="/privacy">Privacy Policy</a>.
        </p>
      </Section>

      <Section id="third" title="Third parties">
        <p>
          The website loads typefaces from Google Fonts; your browser therefore sends your IP address to Google. Google
          Fonts does not set cookies. If you choose to sign in with Google, Google sets its own cookies on its sign-in
          pages under Google&apos;s privacy policy.
        </p>
      </Section>

      <Section id="control" title="Your choices">
        <p>
          You can delete local storage at any time in your browser settings. Signing out removes the session. If you
          clear storage you will be signed out and the workspace will forget local preferences; your research stored on
          our servers is not affected.
        </p>
        <p>
          If we ever introduce optional analytics or similar technologies, we will ask for your consent first and let you
          change that choice at any time.
        </p>
      </Section>
    </LegalLayout>
  );
}
