import Link from 'next/link'

// ── style tokens (matches /privacy) ──────────────────────────────────────────

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

const pSmall: React.CSSProperties = {
  margin: '0 0 14px',
  color: '#c9d1d9',
  fontSize: '13px',
}

const pAllCaps: React.CSSProperties = {
  margin: '0 0 14px',
  color: '#c9d1d9',
  fontSize: '13px',
  lineHeight: 1.7,
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

const disclaimerBox: React.CSSProperties = {
  background: 'rgba(248,81,73,0.06)',
  border: '1px solid rgba(248,81,73,0.25)',
  borderRadius: '10px',
  padding: '20px 24px',
  margin: '0 0 40px',
}

const infoBox: React.CSSProperties = {
  background: '#0d1117',
  border: '1px solid #1e2530',
  borderRadius: '10px',
  padding: '20px 24px',
  margin: '0 0 40px',
}

function B({ children }: { children: React.ReactNode }) {
  return <strong style={{ color: '#e6edf3' }}>{children}</strong>
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function TermsPage() {
  return (
    <div style={wrap}>

      <h1 style={pageTitle}>Terms of Use</h1>
      <p style={subtitle}>Last updated July 07, 2026</p>

      {/* Financial disclaimer */}
      <div style={disclaimerBox}>
        <p style={{ ...pSmall, fontWeight: 700, color: '#f85149', margin: '0 0 8px' }}>
          Financial Disclaimer
        </p>
        <p style={{ ...pSmall, margin: 0, lineHeight: 1.7 }}>
          Sentra Signals provides informational data sourced from public SEC filings only. It is
          not a registered investment advisor and nothing on the platform constitutes investment
          advice. Users are solely responsible for their own investment decisions.
        </p>
      </div>

      <p style={p}>
        These Legal Terms constitute a legally binding agreement between you and Sentra Signals
        ("Company," "we," "us," or "our") concerning your access to and use of{' '}
        <a href="https://www.sentrasignals.com" style={a} target="_blank" rel="noopener noreferrer">
          sentrasignals.com
        </a>{' '}
        and any related services (the "Services"). By accessing the Services, you agree that you
        have read, understood, and agree to be bound by all of these Legal Terms. If you do not
        agree, you are expressly prohibited from using the Services and must discontinue use
        immediately.
      </p>

      {/* TOC */}
      <div style={infoBox}>
        <p style={{ ...pSmall, fontWeight: 700, color: '#e6edf3', margin: '0 0 14px' }}>
          Table of Contents
        </p>
        {[
          ['#dispute',         '11. Dispute Resolution'],
          ['#corrections',     '12. Corrections'],
          ['#disclaimer',      '13. Disclaimer'],
          ['#liability',       '14. Limitations of Liability'],
          ['#indemnification', '15. Indemnification'],
          ['#userdata',        '16. User Data'],
          ['#electronic',      '17. Electronic Communications, Transactions, and Signatures'],
          ['#misc',            '18. Miscellaneous'],
          ['#contact',         '19. Contact Us'],
        ].map(([href, label]) => (
          <a key={href} href={href} style={tocLink}>{label}</a>
        ))}
      </div>

      {/* 11 */}
      <h2 style={h2} id="dispute">11. Dispute Resolution</h2>

      <h3 style={h3}>Informal Negotiations</h3>
      <p style={p}>
        To expedite resolution and control the cost of any dispute, controversy, or claim related
        to these Legal Terms (each a "Dispute" and collectively, the "Disputes") brought by either
        you or us (individually, a "Party" and collectively, the "Parties"), the Parties agree to
        first attempt to negotiate any Dispute (except those Disputes expressly provided below)
        informally for at least <B>30 days</B> before initiating arbitration. Such informal
        negotiations commence upon written notice from one Party to the other Party.
      </p>

      <h3 style={h3}>Binding Arbitration</h3>
      <p style={p}>
        If the parties are unable to resolve the dispute through informal negotiation, the dispute
        shall be finally resolved by arbitration in accordance with the United Nations Commission
        on International Trade Law Arbitration Rules in force at the time of commencement of the
        arbitration. The number of arbitrators shall be <B>1</B>. The seat, or legal place, of
        arbitration shall be <B>New York</B>. The language of the proceedings shall be{' '}
        <B>English</B>. The governing law of these Legal Terms shall be substantive law of the{' '}
        <B>State of New York</B>.
      </p>

      <h3 style={h3}>Restrictions</h3>
      <p style={p}>
        The Parties agree that any arbitration shall be limited to the Dispute between the Parties
        individually. To the full extent permitted by law, (a) no arbitration shall be joined with
        any other proceeding; (b) there is no right or authority for any Dispute to be arbitrated
        on a class-action basis or to utilize class action procedures; and (c) there is no right or
        authority for any Dispute to be brought in a purported representative capacity on behalf of
        the general public or any other persons.
      </p>

      <h3 style={h3}>Exceptions to Informal Negotiations and Arbitration</h3>
      <p style={p}>
        The Parties agree that the following Disputes are not subject to the above provisions
        concerning informal negotiations and binding arbitration: (a) any Disputes seeking to
        enforce or protect, or concerning the validity of, any of the intellectual property rights
        of a Party; (b) any Dispute related to, or arising from, allegations of theft, piracy,
        invasion of privacy, or unauthorized use; and (c) any claim for injunctive relief. If this
        provision is found to be illegal or unenforceable, then neither Party will elect to
        arbitrate any Dispute falling within that portion of this provision found to be illegal or
        unenforceable and such Dispute shall be decided by a court of competent jurisdiction
        within the courts listed for jurisdiction above, and the Parties agree to submit to the
        personal jurisdiction of that court.
      </p>

      {/* 12 */}
      <h2 style={h2} id="corrections">12. Corrections</h2>
      <p style={p}>
        There may be information on the Services that contains typographical errors, inaccuracies,
        or omissions, including descriptions, pricing, availability, and various other information.
        We reserve the right to correct any errors, inaccuracies, or omissions and to change or
        update the information on the Services at any time, without prior notice.
      </p>

      {/* 13 */}
      <h2 style={h2} id="disclaimer">13. Disclaimer</h2>
      <p style={pAllCaps}>
        THE SERVICES ARE PROVIDED ON AN AS-IS AND AS-AVAILABLE BASIS. YOU AGREE THAT YOUR USE OF
        THE SERVICES WILL BE AT YOUR SOLE RISK. TO THE FULLEST EXTENT PERMITTED BY LAW, WE
        DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, IN CONNECTION WITH THE SERVICES AND YOUR USE
        THEREOF, INCLUDING, WITHOUT LIMITATION, THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS
        FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE MAKE NO WARRANTIES OR REPRESENTATIONS
        ABOUT THE ACCURACY OR COMPLETENESS OF THE SERVICES' CONTENT OR THE CONTENT OF ANY WEBSITES
        OR MOBILE APPLICATIONS LINKED TO THE SERVICES AND WE WILL ASSUME NO LIABILITY OR
        RESPONSIBILITY FOR ANY (1) ERRORS, MISTAKES, OR INACCURACIES OF CONTENT AND MATERIALS,
        (2) PERSONAL INJURY OR PROPERTY DAMAGE, OF ANY NATURE WHATSOEVER, RESULTING FROM YOUR
        ACCESS TO AND USE OF THE SERVICES, (3) ANY UNAUTHORIZED ACCESS TO OR USE OF OUR SECURE
        SERVERS AND/OR ANY AND ALL PERSONAL INFORMATION AND/OR FINANCIAL INFORMATION STORED
        THEREIN, (4) ANY INTERRUPTION OR CESSATION OF TRANSMISSION TO OR FROM THE SERVICES,
        (5) ANY BUGS, VIRUSES, TROJAN HORSES, OR THE LIKE WHICH MAY BE TRANSMITTED TO OR THROUGH
        THE SERVICES BY ANY THIRD PARTY, AND/OR (6) ANY ERRORS OR OMISSIONS IN ANY CONTENT AND
        MATERIALS OR FOR ANY LOSS OR DAMAGE OF ANY KIND INCURRED AS A RESULT OF THE USE OF ANY
        CONTENT POSTED, TRANSMITTED, OR OTHERWISE MADE AVAILABLE VIA THE SERVICES. WE DO NOT
        WARRANT, ENDORSE, GUARANTEE, OR ASSUME RESPONSIBILITY FOR ANY PRODUCT OR SERVICE
        ADVERTISED OR OFFERED BY A THIRD PARTY THROUGH THE SERVICES, ANY HYPERLINKED WEBSITE, OR
        ANY WEBSITE OR MOBILE APPLICATION FEATURED IN ANY BANNER OR OTHER ADVERTISING, AND WE
        WILL NOT BE A PARTY TO OR IN ANY WAY BE RESPONSIBLE FOR MONITORING ANY TRANSACTION
        BETWEEN YOU AND ANY THIRD-PARTY PROVIDERS OF PRODUCTS OR SERVICES. AS WITH THE PURCHASE
        OF A PRODUCT OR SERVICE THROUGH ANY MEDIUM OR IN ANY ENVIRONMENT, YOU SHOULD USE YOUR
        BEST JUDGMENT AND EXERCISE CAUTION WHERE APPROPRIATE.
      </p>

      {/* 14 */}
      <h2 style={h2} id="liability">14. Limitations of Liability</h2>
      <p style={pAllCaps}>
        IN NO EVENT WILL WE OR OUR DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE TO YOU OR ANY THIRD
        PARTY FOR ANY DIRECT, INDIRECT, CONSEQUENTIAL, EXEMPLARY, INCIDENTAL, SPECIAL, OR
        PUNITIVE DAMAGES, INCLUDING LOST PROFIT, LOST REVENUE, LOSS OF DATA, OR OTHER DAMAGES
        ARISING FROM YOUR USE OF THE SERVICES, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY
        OF SUCH DAMAGES. NOTWITHSTANDING ANYTHING TO THE CONTRARY CONTAINED HEREIN, OUR
        LIABILITY TO YOU FOR ANY CAUSE WHATSOEVER AND REGARDLESS OF THE FORM OF THE ACTION, WILL
        AT ALL TIMES BE LIMITED TO THE LESSER OF THE AMOUNT PAID, IF ANY, BY YOU TO US OR{' '}
        <span style={{ background: 'rgba(158,203,255,0.08)', padding: '0 3px', borderRadius: '3px' }}>
          $100 USD
        </span>
        . CERTAIN US STATE LAWS AND INTERNATIONAL LAWS DO NOT ALLOW LIMITATIONS ON IMPLIED
        WARRANTIES OR THE EXCLUSION OR LIMITATION OF CERTAIN DAMAGES. IF THESE LAWS APPLY TO
        YOU, SOME OR ALL OF THE ABOVE DISCLAIMERS OR LIMITATIONS MAY NOT APPLY TO YOU, AND YOU
        MAY HAVE ADDITIONAL RIGHTS.
      </p>

      {/* 15 */}
      <h2 style={h2} id="indemnification">15. Indemnification</h2>
      <p style={p}>
        You agree to defend, indemnify, and hold us harmless, including our subsidiaries,
        affiliates, and all of our respective officers, agents, partners, and employees, from and
        against any loss, damage, liability, claim, or demand, including reasonable attorneys'
        fees and expenses, made by any third party due to or arising out of: (1) use of the
        Services; (2) breach of these Legal Terms; (3) any breach of your representations and
        warranties set forth in these Legal Terms; (4) your violation of the rights of a third
        party, including but not limited to intellectual property rights; or (5) any overt harmful
        act toward any other user of the Services with whom you connected via the Services.
        Notwithstanding the foregoing, we reserve the right, at your expense, to assume the
        exclusive defense and control of any matter for which you are required to indemnify us,
        and you agree to cooperate, at your expense, with our defense of such claims. We will use
        reasonable efforts to notify you of any such claim, action, or proceeding which is subject
        to this indemnification upon becoming aware of it.
      </p>

      {/* 16 */}
      <h2 style={h2} id="userdata">16. User Data</h2>
      <p style={p}>
        We will maintain certain data that you transmit to the Services for the purpose of
        managing the performance of the Services, as well as data relating to your use of the
        Services. Although we perform regular routine backups of data, you are solely responsible
        for all data that you transmit or that relates to any activity you have undertaken using
        the Services. You agree that we shall have no liability to you for any loss or corruption
        of any such data, and you hereby waive any right of action against us arising from any
        such loss or corruption of such data.
      </p>

      {/* 17 */}
      <h2 style={h2} id="electronic">17. Electronic Communications, Transactions, and Signatures</h2>
      <p style={p}>
        Visiting the Services, sending us emails, and completing online forms constitute electronic
        communications. You consent to receive electronic communications, and you agree that all
        agreements, notices, disclosures, and other communications we provide to you
        electronically, via email and on the Services, satisfy any legal requirement that such
        communication be in writing.{' '}
        <span style={{ textTransform: 'uppercase' }}>
          YOU HEREBY AGREE TO THE USE OF ELECTRONIC SIGNATURES, CONTRACTS, ORDERS, AND OTHER
          RECORDS, AND TO ELECTRONIC DELIVERY OF NOTICES, POLICIES, AND RECORDS OF TRANSACTIONS
          INITIATED OR COMPLETED BY US OR VIA THE SERVICES.
        </span>{' '}
        You hereby waive any rights or requirements under any statutes, regulations, rules,
        ordinances, or other laws in any jurisdiction which require an original signature or
        delivery or retention of non-electronic records, or to payments or the granting of credits
        by any means other than electronic means.
      </p>

      {/* 18 */}
      <h2 style={h2} id="misc">18. Miscellaneous</h2>
      <p style={p}>
        These Legal Terms and any policies or operating rules posted by us on the Services or in
        respect to the Services constitute the entire agreement and understanding between you and
        us. Our failure to exercise or enforce any right or provision of these Legal Terms shall
        not operate as a waiver of such right or provision. These Legal Terms operate to the
        fullest extent permissible by law. We may assign any or all of our rights and obligations
        to others at any time. We shall not be responsible or liable for any loss, damage, delay,
        or failure to act caused by any cause beyond our reasonable control. If any provision or
        part of a provision of these Legal Terms is determined to be unlawful, void, or
        unenforceable, that provision or part of the provision is deemed severable from these
        Legal Terms and does not affect the validity and enforceability of any remaining
        provisions. There is no joint venture, partnership, employment or agency relationship
        created between you and us as a result of these Legal Terms or use of the Services. You
        agree that these Legal Terms will not be construed against us by virtue of having drafted
        them. You hereby waive any and all defenses you may have based on the electronic form of
        these Legal Terms and the lack of signing by the parties hereto to execute these Legal
        Terms.
      </p>

      {/* 19 */}
      <h2 style={h2} id="contact">19. Contact Us</h2>
      <p style={p}>
        In order to resolve a complaint regarding the Services or to receive further information
        regarding use of the Services, please contact us at:
      </p>
      <div style={{ ...infoBox, margin: '0 0 24px' }}>
        <p style={{ ...pSmall, margin: '0 0 4px', color: '#e6edf3', fontWeight: 700 }}>
          Sentra Signals
        </p>
        <p style={{ ...pSmall, margin: '0 0 4px' }}>
          <a href="mailto:deangans815@gmail.com" style={a}>deangans815@gmail.com</a>
        </p>
        <p style={{ ...pSmall, margin: 0 }}>
          New York, NY, United States
        </p>
      </div>

      {/* back link */}
      <div style={{ marginTop: '64px', paddingTop: '24px', borderTop: '1px solid #1e2530' }}>
        <Link href="/" style={{ color: '#7b8498', textDecoration: 'none', fontSize: '13px' }}>
          Back to Sentra Signals
        </Link>
      </div>

    </div>
  )
}
