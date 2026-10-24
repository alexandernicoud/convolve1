import { LegalLayout, Section, Table } from "./LegalLayout";

export default function CookiesPage() {
  return (
    <LegalLayout
      title="Cookies and browser storage"
      intro={
        <p>
          Convolve does not use analytics, advertising or tracking cookies. It only stores what the website needs to
          work in your browser, so there is no consent banner.
        </p>
      }
    >
      <Section id="storage" title="What is stored in your browser">
        <Table
          head={["Name", "Type", "Purpose", "Duration"]}
          rows={[
            ["convolve-auth", "Local storage", "Keeps you signed in (session and refresh token)", "Until you sign out or the session ends"],
            ["convolve_runs", "Local storage", "Remembers your active and recent research runs in the workspace", "Until cleared"],
            ["Workspace preferences", "Local storage", "Dashboard guide dismissal, simulated wallet size and similar interface settings", "Until cleared"],
          ]}
        />
        <p>
          These items are strictly necessary to provide the workspace you requested. They are not shared with third
          parties and are not used to track you across websites.
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
