import Link from 'next/link'

// ── style tokens ──────────────────────────────────────────────────────────────

const wrap: React.CSSProperties = {
  maxWidth: '800px',
  margin: '0 auto',
  padding: '100px 40px 100px',
  fontFamily: 'Arial, sans-serif',
  color: '#c9d1d9',
  lineHeight: 1.75,
  fontSize: '14px',
}

const pageTitle: React.CSSProperties = {
  fontSize: '32px',
  fontWeight: 800,
  color: '#e6edf3',
  letterSpacing: '-0.5px',
  margin: '0 0 8px',
}

const subtitle: React.CSSProperties = {
  fontSize: '14px',
  color: '#7b8498',
  margin: '0 0 48px',
}

const h2: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 700,
  color: '#e6edf3',
  margin: '48px 0 14px',
  paddingTop: '8px',
  borderTop: '1px solid #1e2530',
}

const h3: React.CSSProperties = {
  fontSize: '15px',
  fontWeight: 700,
  color: '#e6edf3',
  margin: '28px 0 10px',
}

const p: React.CSSProperties = {
  margin: '0 0 14px',
  color: '#c9d1d9',
}

const ul: React.CSSProperties = {
  margin: '0 0 14px',
  paddingLeft: '24px',
  color: '#c9d1d9',
}

const li: React.CSSProperties = {
  margin: '6px 0',
}

const a: React.CSSProperties = {
  color: '#9ecbff',
  textDecoration: 'underline',
}

const tocLink: React.CSSProperties = {
  display: 'block',
  color: '#9ecbff',
  textDecoration: 'none',
  fontSize: '13px',
  padding: '4px 0',
}

const summaryBox: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #1e2530',
  borderRadius: '10px',
  padding: '24px 28px',
  margin: '0 0 40px',
}

const strong = (text: string) => (
  <strong style={{ color: '#e6edf3' }}>{text}</strong>
)

// ── page ──────────────────────────────────────────────────────────────────────

export default function PrivacyPage() {
  return (
    <div style={wrap}>

      <h1 style={pageTitle}>Privacy Policy</h1>
      <p style={subtitle}>Last updated July 07, 2026</p>

      <p style={p}>
        This Privacy Notice for Sentra Signals ("we," "us," or "our") describes how and why we might
        access, collect, store, use, and/or share ("process") your personal information when you use
        our services ("Services"), including when you:
      </p>
      <ul style={ul}>
        <li style={li}>
          Visit our website at{' '}
          <a href="https://www.sentrasignals.com" style={a} target="_blank" rel="noopener noreferrer">
            https://www.sentrasignals.com
          </a>{' '}
          or any website of ours that links to this Privacy Notice
        </li>
        <li style={li}>
          Use Sentra Signals. Sentra Signals is an insider-activity radar. It tracks SEC Form 4
          insider filings across the Russell 3000, classifies them, and surfaces the trades that
          carry real signal. It provides informational data only and is not investment advice.
        </li>
        <li style={li}>
          Engage with us in other related ways, including any marketing or events
        </li>
      </ul>
      <p style={p}>
        {strong('Questions or concerns? ')}
        Reading this Privacy Notice will help you understand your privacy rights and choices. We are
        responsible for making decisions about how your personal information is processed. If you do
        not agree with our policies and practices, please do not use our Services. If you still have
        any questions or concerns, please contact us at{' '}
        <a href="mailto:deangans815@gmail.com" style={a}>deangans815@gmail.com</a>.
      </p>

      {/* Summary */}
      <h2 style={h2}>Summary of Key Points</h2>
      <div style={summaryBox}>
        <p style={{ ...p, fontStyle: 'italic', color: '#7b8498', marginBottom: '18px' }}>
          This summary provides key points from our Privacy Notice. You can find more details about
          any of these topics by using the table of contents below.
        </p>
        <p style={p}>
          {strong('What personal information do we process? ')}
          When you visit, use, or navigate our Services, we may process personal information
          depending on how you interact with us and the Services, the choices you make, and the
          features you use.
        </p>
        <p style={p}>
          {strong('Do we process any sensitive personal information? ')}
          We do not process sensitive personal information.
        </p>
        <p style={p}>
          {strong('Do we collect any information from third parties? ')}
          We do not collect any information from third parties.
        </p>
        <p style={p}>
          {strong('How do we process your information? ')}
          We process your information to provide, improve, and administer our Services, communicate
          with you, for security and fraud prevention, and to comply with law.
        </p>
        <p style={p}>
          {strong('In what situations and with which parties do we share personal information? ')}
          We may share information in specific situations and with specific third parties.
        </p>
        <p style={p}>
          {strong('How do we keep your information safe? ')}
          We have adequate organizational and technical processes and procedures in place to protect
          your personal information. However, no electronic transmission over the internet can be
          guaranteed 100% secure.
        </p>
        <p style={p}>
          {strong('What are your rights? ')}
          Depending on where you are located geographically, applicable privacy law may give you
          certain rights regarding your personal information.
        </p>
        <p style={{ ...p, margin: 0 }}>
          {strong('How do you exercise your rights? ')}
          The easiest way is by contacting us at{' '}
          <a href="mailto:deangans815@gmail.com" style={a}>deangans815@gmail.com</a>.
          We will consider and act upon any request in accordance with applicable data protection laws.
        </p>
      </div>

      {/* TOC */}
      <h2 style={{ ...h2, borderTop: 'none', paddingTop: 0 }} id="toc">Table of Contents</h2>
      {[
        ['#infocollect',    '1. What information do we collect?'],
        ['#infouse',        '2. How do we process your information?'],
        ['#whoshare',       '3. When and with whom do we share your personal information?'],
        ['#cookies',        '4. Do we use cookies and other tracking technologies?'],
        ['#sociallogins',   '5. How do we handle your social logins?'],
        ['#inforetain',     '6. How long do we keep your information?'],
        ['#infosafe',       '7. How do we keep your information safe?'],
        ['#infominors',     '8. Do we collect information from minors?'],
        ['#privacyrights',  '9. What are your privacy rights?'],
        ['#DNT',            '10. Controls for do-not-track features'],
        ['#uslaws',         '11. Do United States residents have specific privacy rights?'],
        ['#policyupdates',  '12. Do we make updates to this notice?'],
        ['#contact',        '13. How can you contact us about this notice?'],
        ['#request',        '14. How can you review, update, or delete the data we collect from you?'],
      ].map(([href, label]) => (
        <a key={href} href={href} style={tocLink}>{label}</a>
      ))}

      {/* 1 */}
      <h2 style={h2} id="infocollect">1. What Information Do We Collect?</h2>
      <h3 style={h3} id="personalinfo">Personal information you disclose to us</h3>
      <p style={p}><em>In Short: We collect personal information that you provide to us.</em></p>
      <p style={p}>
        We collect personal information that you voluntarily provide to us when you register on the
        Services, express an interest in obtaining information about us or our products and Services,
        when you participate in activities on the Services, or otherwise when you contact us.
      </p>
      <p style={p}>
        {strong('Personal Information Provided by You. ')}
        The personal information that we collect depends on the context of your interactions with us
        and the Services, the choices you make, and the products and features you use. The personal
        information we collect may include the following:
      </p>
      <ul style={ul}>
        <li style={li}>email addresses</li>
        <li style={li}>usernames</li>
        <li style={li}>passwords</li>
        <li style={li}>job titles</li>
      </ul>
      <p style={p}>
        {strong('Social Media Login Data. ')}
        We may provide you with the option to register with us using your existing Google account.
        If you choose to register in this way, we will collect certain profile information about you
        from Google, as described in the section called "How Do We Handle Your Social Logins?" below.
      </p>
      <p style={p}>
        All personal information that you provide to us must be true, complete, and accurate, and
        you must notify us of any changes to such personal information.
      </p>

      <h3 style={h3}>Google API</h3>
      <p style={p}>
        Our use of information received from Google APIs will adhere to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" style={a} target="_blank" rel="noopener noreferrer">
          Google API Services User Data Policy
        </a>
        , including the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy#limited-use" style={a} target="_blank" rel="noopener noreferrer">
          Limited Use requirements
        </a>.
      </p>

      {/* 2 */}
      <h2 style={h2} id="infouse">2. How Do We Process Your Information?</h2>
      <p style={p}><em>In Short: We process your information to provide, improve, and administer our Services, communicate with you, for security and fraud prevention, and to comply with law.</em></p>
      <p style={p}>
        {strong('We process your personal information for a variety of reasons, depending on how you interact with our Services, including:')}
      </p>
      <ul style={ul}>
        <li style={li}>
          {strong('To facilitate account creation and authentication and otherwise manage user accounts. ')}
          We may process your information so you can create and log in to your account, as well as
          keep your account in working order.
        </li>
        <li style={li}>
          {strong('To deliver and facilitate delivery of services to the user. ')}
          We may process your information to provide you with the requested service.
        </li>
        <li style={li}>
          {strong('To respond to user inquiries/offer support to users. ')}
          We may process your information to respond to your inquiries and solve any potential issues
          you might have with the requested service.
        </li>
        <li style={li}>
          {strong('To request feedback. ')}
          We may process your information when necessary to request feedback and to contact you about
          your use of our Services.
        </li>
        <li style={li}>
          {strong('To send you marketing and promotional communications. ')}
          We may process the personal information you send to us for our marketing purposes, if this
          is in accordance with your marketing preferences. You can opt out of our marketing emails
          at any time. For more information, see "What Are Your Privacy Rights?" below.
        </li>
        <li style={li}>
          {strong('To save or protect an individual\'s vital interest. ')}
          We may process your information when necessary to save or protect an individual\'s vital
          interest, such as to prevent harm.
        </li>
      </ul>

      {/* 3 */}
      <h2 style={h2} id="whoshare">3. When and With Whom Do We Share Your Personal Information?</h2>
      <p style={p}><em>In Short: We may share information in specific situations described in this section and/or with the following third parties.</em></p>
      <p style={p}>
        We may need to share your personal information in the following situations:
      </p>
      <ul style={ul}>
        <li style={li}>
          {strong('Business Transfers. ')}
          We may share or transfer your information in connection with, or during negotiations of,
          any merger, sale of company assets, financing, or acquisition of all or a portion of our
          business to another company.
        </li>
        <li style={li}>
          {strong('Affiliates. ')}
          We may share your information with our affiliates, in which case we will require those
          affiliates to honor this Privacy Notice.
        </li>
        <li style={li}>
          {strong('Business Partners. ')}
          We may share your information with our business partners to offer you certain products,
          services, or promotions.
        </li>
      </ul>

      {/* 4 */}
      <h2 style={h2} id="cookies">4. Do We Use Cookies and Other Tracking Technologies?</h2>
      <p style={p}><em>In Short: We may use cookies and other tracking technologies to collect and store your information.</em></p>
      <p style={p}>
        We may use cookies and similar tracking technologies (like web beacons and pixels) to access
        or store information. We use cookies for the following purposes:
      </p>
      <ul style={ul}>
        <li style={li}>
          {strong('Strictly necessary cookies. ')}
          These cookies are required to operate the site and cannot be switched off. They are usually
          set in response to actions you take such as setting your privacy preferences, logging in,
          or filling in forms.
        </li>
        <li style={li}>
          {strong('Functional cookies. ')}
          These cookies enable the website to provide enhanced functionality. They may be set by us
          or by third-party providers whose services we have added to our pages.
        </li>
        <li style={li}>
          {strong('Performance and analytics cookies. ')}
          These cookies allow us to count visits and traffic sources so we can measure and improve
          the performance of our site. All information these cookies collect is aggregated and
          therefore anonymous.
        </li>
      </ul>
      <p style={p}>
        We do not use cookies for advertising or targeted marketing purposes. You can set your
        browser to refuse all or some browser cookies, or to alert you when websites set or access
        cookies. If you disable or refuse cookies, please note that some parts of the Services may
        become inaccessible or not function properly.
      </p>

      {/* 5 */}
      <h2 style={h2} id="sociallogins">5. How Do We Handle Your Social Logins?</h2>
      <p style={p}><em>In Short: If you choose to register or log in to our Services using Google, we may have access to certain information about you.</em></p>
      <p style={p}>
        Our Services offer you the ability to register and log in using your Google account.
        Where you choose to do this, we will receive certain profile information about you from
        Google. The profile information we receive may include your name, email address, and profile
        picture.
      </p>
      <p style={p}>
        We will use the information we receive only for the purposes described in this Privacy
        Notice or that are otherwise made clear to you on the relevant Services. Please note that
        we do not control, and are not responsible for, other uses of your personal information by
        Google. We recommend that you review their privacy notice to understand how they collect,
        use, and share your personal information.
      </p>

      {/* 6 */}
      <h2 style={h2} id="inforetain">6. How Long Do We Keep Your Information?</h2>
      <p style={p}><em>In Short: We keep your information for as long as necessary to fulfill the purposes outlined in this Privacy Notice unless otherwise required by law.</em></p>
      <p style={p}>
        We will only keep your personal information for as long as it is necessary for the purposes
        set out in this Privacy Notice, unless a longer retention period is required or permitted by
        law (such as tax, accounting, or other legal requirements).
      </p>
      <p style={p}>
        When we have no ongoing legitimate business need to process your personal information, we
        will either delete or anonymize such information, or if this is not possible (for example,
        because your personal information has been stored in backup archives), then we will securely
        store your personal information and isolate it from any further processing until deletion is
        possible.
      </p>

      {/* 7 */}
      <h2 style={h2} id="infosafe">7. How Do We Keep Your Information Safe?</h2>
      <p style={p}><em>In Short: We aim to protect your personal information through a system of organizational and technical security measures.</em></p>
      <p style={p}>
        We have implemented appropriate and reasonable technical and organizational security measures
        designed to protect the security of any personal information we process. However, despite our
        safeguards and efforts to secure your information, no electronic transmission over the
        internet or information storage technology can be guaranteed to be 100% secure, so we cannot
        promise or guarantee that hackers, cybercriminals, or other unauthorized third parties will
        not be able to defeat our security and improperly collect, access, steal, or modify your
        information.
      </p>
      <p style={p}>
        Although we will do our best to protect your personal information, transmission of personal
        information to and from our Services is at your own risk. You should only access the
        Services within a secure environment.
      </p>

      {/* 8 */}
      <h2 style={h2} id="infominors">8. Do We Collect Information From Minors?</h2>
      <p style={p}><em>In Short: We do not knowingly collect data from or market to children under 18 years of age.</em></p>
      <p style={p}>
        We do not knowingly collect, solicit data from, or market to children under 18 years of age,
        nor do we knowingly sell such personal information. By using the Services, you represent that
        you are at least 18 or that you are the parent or guardian of such a minor and consent to
        such minor dependent's use of the Services. If we learn that personal information from users
        less than 18 years of age has been collected, we will deactivate the account and take
        reasonable measures to promptly delete such data from our records. If you become aware of
        any data we may have collected from children under age 18, please contact us at{' '}
        <a href="mailto:deangans815@gmail.com" style={a}>deangans815@gmail.com</a>.
      </p>

      {/* 9 */}
      <h2 style={h2} id="privacyrights">9. What Are Your Privacy Rights?</h2>
      <p style={p}><em>In Short: You may review, change, or terminate your account at any time.</em></p>
      <p style={p}>
        {strong('Withdrawing your consent. ')}
        If we are relying on your consent to process your personal information, which may be express
        and/or implied consent depending on the applicable law, you have the right to withdraw your
        consent at any time. You can withdraw your consent at any time by contacting us using the
        contact details provided in the section "How Can You Contact Us About This Notice?" below.
      </p>
      <p style={p}>
        However, please note that this will not affect the lawfulness of the processing before its
        withdrawal nor, when applicable law allows, will it affect the processing of your personal
        information conducted in reliance on lawful processing grounds other than consent.
      </p>
      <p style={p}>
        {strong('Opting out of marketing communications. ')}
        You can unsubscribe from our marketing and promotional communications at any time by clicking
        on the unsubscribe link in the emails that we send, or by contacting us using the details
        provided below. You will then be removed from the marketing lists. However, we may still
        communicate with you, for example to send you service-related messages that are necessary
        for the administration and use of your account.
      </p>
      <h3 style={h3}>Account Information</h3>
      <p style={p}>
        If you would at any time like to review or change the information in your account or
        terminate your account, you can contact us using the contact information provided. Upon your
        request to terminate your account, we will deactivate or delete your account and information
        from our active databases. However, we may retain some information in our files to prevent
        fraud, troubleshoot problems, assist with any investigations, enforce our legal terms, and/or
        comply with applicable legal requirements.
      </p>

      {/* 10 */}
      <h2 style={h2} id="DNT">10. Controls for Do-Not-Track Features</h2>
      <p style={p}>
        Most web browsers and some mobile operating systems and mobile applications include a
        Do-Not-Track ("DNT") feature or setting you can activate to signal your privacy preference
        not to have data about your online browsing activities monitored and collected. At this stage,
        no uniform technology standard for recognizing and implementing DNT signals has been
        finalized. As such, we do not currently respond to DNT browser signals or any other
        mechanism that automatically communicates your choice not to be tracked online. If a standard
        for online tracking is adopted that we must follow in the future, we will inform you about
        that practice in a revised version of this Privacy Notice.
      </p>

      {/* 11 */}
      <h2 style={h2} id="uslaws">11. Do United States Residents Have Specific Privacy Rights?</h2>
      <p style={p}><em>In Short: If you are a resident of certain US states, you may have additional rights regarding your personal information.</em></p>
      <p style={p}>
        Depending on the state where you live, you may have the right to: (1) know whether we
        collect and use your personal information, (2) delete your personal information, (3) correct
        inaccurate personal information, (4) request that we limit our use and disclosure of your
        sensitive personal information, (5) opt out of the processing of your personal information
        for purposes of targeted advertising, the sale of personal information, or profiling, and
        (6) not be discriminated against for exercising your rights.
      </p>
      <p style={p}>
        We do not sell personal information, share personal information for cross-context behavioral
        advertising, or process sensitive personal information for inferences.
      </p>
      <p style={p}>
        To exercise these rights, you can contact us at{' '}
        <a href="mailto:deangans815@gmail.com" style={a}>deangans815@gmail.com</a>{' '}
        or by submitting a{' '}
        <a href="https://app.termly.io/dsar/f14d22df-0228-4913-ac99-21349010b3d4" style={a} target="_blank" rel="noopener noreferrer">
          data subject access request
        </a>.
      </p>

      {/* 12 */}
      <h2 style={h2} id="policyupdates">12. Do We Make Updates to This Notice?</h2>
      <p style={p}><em>In Short: Yes, we will update this notice as necessary to stay compliant with relevant laws.</em></p>
      <p style={p}>
        We may update this Privacy Notice from time to time. The updated version will be indicated
        by an updated "Last updated" date at the top of this Privacy Notice. If we make material
        changes to this Privacy Notice, we may notify you either by prominently posting a notice of
        such changes or by directly sending you a notification. We encourage you to review this
        Privacy Notice frequently to be informed of how we are protecting your information.
      </p>

      {/* 13 */}
      <h2 style={h2} id="contact">13. How Can You Contact Us About This Notice?</h2>
      <p style={p}>
        If you have questions or comments about this notice, you may email us at{' '}
        <a href="mailto:deangans815@gmail.com" style={a}>deangans815@gmail.com</a>.
      </p>

      {/* 14 */}
      <h2 style={h2} id="request">14. How Can You Review, Update, or Delete the Data We Collect From You?</h2>
      <p style={p}>
        Based on the applicable laws of your country, you may have the right to request access to
        the personal information we collect from you, details about how we have processed it, correct
        inaccuracies, or delete your personal information. To request to review, update, or delete
        your personal information, please submit a{' '}
        <a href="https://app.termly.io/dsar/f14d22df-0228-4913-ac99-21349010b3d4" style={a} target="_blank" rel="noopener noreferrer">
          data subject access request
        </a>{' '}
        or email us at{' '}
        <a href="mailto:deangans815@gmail.com" style={a}>deangans815@gmail.com</a>.
      </p>

      {/* back link */}
      <div style={{ marginTop: '64px', paddingTop: '24px', borderTop: '1px solid #1e2530' }}>
        <Link href="/" style={{ color: '#7b8498', textDecoration: 'none', fontSize: '13px' }}>
          Back to Sentra Signals
        </Link>
      </div>

    </div>
  )
}
