from pathlib import Path
import sys, tempfile
sys.path.insert(0, str(Path('.pdf-tools').resolve()))
import re
import xml.etree.ElementTree as ET

OUT = Path('output/pdf')
OUT.mkdir(parents=True, exist_ok=True)
pages = []
def add(title, body): pages.append((title, body))

add('Project goal and scope', '''
<p class="lead">Dr. Manzar ul Haque Literary Website</p>
<p>Software Requirements Specification and Chunked Delivery Plan</p>
<p><b>Version:</b> 1.0 | <b>Date:</b> 29 October 2026<br><b>Status:</b> Proposed baseline for discussion. Website implementation has not started.</p>
<h2>Primary goal</h2><p>Create a bilingual English and Urdu author platform in React that preserves the supplied visual design, helps readers discover and listen to literary work, sells books securely, and lets authorised staff manage content and orders through an admin panel.</p>
<h2>Success means</h2><ul><li>Readers can browse books, read articles, listen to narration and switch languages.</li><li>Customers can pay, receive their purchased digital edition or track a printed order, according to the formats selected for launch.</li><li>The owner can publish books, articles, pages and audio without editing code.</li><li>Payment, access-control, accessibility and recovery checks pass before launch.</li></ul>
<h2>Source material</h2><p>The two-page "Dr Manzar website designs .pdf", the supplied literary-platform notes, and the planning conversation. Document suggestions are reference material; the user's explicit requirements determine scope.</p>
<h2>Scope boundary</h2><p>This document plans the website. OCR, full-book digitisation, translation production, social-media campaigns, institutional outreach and native mobile apps are separate workstreams. Full audiobooks and recurring subscriptions are not assumed.</p>
''')
add('Design, pages and system boundaries', '''
<h2>Design requirements</h2><p>Preserve the reference's cream background, burgundy accents, dark featured-book section, literary headings, rounded buttons and arched portrait. Retain the homepage order: navigation, author introduction, latest book, all books, articles and video, newsletter, footer. Inner pages and mobile layouts extend this style.</p>
<h2>Public pages</h2><ul><li>Home; books catalogue; individual book and sample.</li><li>Articles catalogue and individual article, with categories and search.</li><li>Videos; biography; media and speaking; contact.</li><li>Cart; checkout handoff; payment result and order status.</li><li>Purchase access, optional customer account, library and orders.</li><li>Privacy, terms, refund and shipping policies as applicable.</li></ul>
<h2>System components</h2><p>React frontend; server-side API; database for content, users and orders; private file storage for paid files; public media delivery; Stripe integration; transactional email and newsletter integration. Backend framework, hosting and providers are to be selected in Chunk 1.</p>
<h2>Roles</h2><table><tr><th>Role</th><th>Access</th></tr><tr><td>Visitor</td><td>Public reading, listening, searching and enquiries.</td></tr><tr><td>Buyer</td><td>Own purchases, downloads and order information.</td></tr><tr><td>Editor</td><td>Assigned content and media; no refunds or staff administration.</td></tr><tr><td>Owner/admin</td><td>Content, store operations, staff and configuration.</td></tr></table>
<p>Admin controls manage approved content and configuration; arbitrary layout/code editing and exposure of payment secrets are excluded.</p>
''')
add('Delivery chunks and review gates', '''
<p>Implement one chunk at a time. Demonstrate its acceptance criteria before progressing. No delivery dates are committed until scope, assets and hosting are agreed.</p>
<table><tr><th>Chunk</th><th>Goal and deliverable</th><th>Exit gate</th></tr>
<tr><td>1. Decisions and foundation</td><td>Confirm formats, audio, merchant eligibility and architecture; inventory assets; define bilingual content model, roles and environments.</td><td>Decisions recorded; missing content listed; architecture agreed.</td></tr>
<tr><td>2. Bilingual design</td><td>React shell and PDF-matched homepage; English/Urdu routing, RTL, responsive layouts and audio player.</td><td>Both languages reviewed on mobile and desktop; player usable by keyboard.</td></tr>
<tr><td>3. Admin and publishing</td><td>Secure admin, role checks, media uploads, bilingual book/article/page editing, drafts, previews and revisions.</td><td>Owner publishes a book and article; editor cannot use owner functions.</td></tr>
<tr><td>4. Reader experience</td><td>Catalogues, detail pages, search, samples, narration, videos and related content.</td><td>Published content appears correctly; language and audio journeys pass.</td></tr>
<tr><td>5. Store and delivery</td><td>Cart, Stripe test checkout, confirmed orders, protected digital delivery and/or stock/shipping workflow; purchase recovery.</td><td>Success, failure, pending, duplicate notification and access tests pass.</td></tr>
<tr><td>6. Engagement and operations</td><td>Contact, speaking enquiries, newsletter, order support, refund workflow and admin summaries.</td><td>Messages, consent, unsubscribe and authorised refund paths verified.</td></tr>
<tr><td>7. Release and handover</td><td>Security review, accessibility, SEO, performance, restore test, live configuration and owner guide.</td><td>Launch checklist accepted; production payment smoke test when eligible.</td></tr></table>
<p>Security is implemented in every chunk; Chunk 7 verifies the whole system. Merchant eligibility blocks live Stripe activation, but does not block design or test-mode development.</p>
''')
add('Functional requirements: reading and languages', '''
<table><tr><th>ID</th><th>Requirement and acceptance</th></tr>
<tr><td>FR-01</td><td>Provide /en/ and /ur/ routes with equivalent-page switching, correct language metadata, LTR English and RTL Urdu. Switching retains the current content where a translation exists.</td></tr>
<tr><td>FR-02</td><td>Translate navigation, forms, validation, descriptions and website-generated messages. Mark missing translations honestly; do not silently present an English article as translated Urdu.</td></tr>
<tr><td>FR-03</td><td>Display books with title, cover, synopsis, publication details, available formats, price/availability and sample. Admin can add more than the initial five books.</td></tr>
<tr><td>FR-04</td><td>Provide article lists, categories, dates and readable detail pages. Search published book/article titles and configured text in both scripts; unpublished work stays excluded.</td></tr>
<tr><td>FR-05</td><td>Show Listen on each public editorial/content page, including articles, biography and book introductions. Play only the selected language's narration; no autoplay.</td></tr>
<tr><td>FR-06</td><td>Audio supports play/pause, seek, playback speed and volume, with accessible labels. Stop/reset narration when language or content changes. Explain unavailable/broken audio without blocking reading.</td></tr>
<tr><td>FR-07</td><td>Require narration readiness per language in the publishing checklist. Audio production method remains undecided; uploaded recordings are the proposed baseline.</td></tr>
<tr><td>FR-08</td><td>Display video links/embeds and related content. Provide shareable page URLs and contact/social links configured by admin.</td></tr></table>
<h2>Audio boundary</h2><p>"Every page" is interpreted as every public editorial/content page. Cart, account, checkout and order pages use accessible controls, not narration of private details. Catalogue narration introduces the page; it does not read an unlimited list. This interpretation needs confirmation.</p>
<h2>External language boundary</h2><p>The website and its messages are bilingual. Urdu availability inside Stripe-hosted checkout and other vendor interfaces must be checked; do not promise a translated external interface before verification.</p>
''')
add('Functional requirements: admin and engagement', '''
<table><tr><th>ID</th><th>Requirement and acceptance</th></tr>
<tr><td>FR-09</td><td>Owner manages staff roles. Backend checks permissions on every protected action, regardless of visible buttons.</td></tr>
<tr><td>FR-10</td><td>Manage books, articles, pages, categories, audio, videos and images through admin. Create drafts, preview both languages, schedule, publish, unpublish and recover previous content revisions.</td></tr>
<tr><td>FR-11</td><td>Manage author portrait, introduction, featured book, selected content, navigation, footer, contact information and social links within approved templates.</td></tr>
<tr><td>FR-12</td><td>Upload covers, samples, digital editions and narration; show validation failures and upload progress. Replacing paid files must preserve purchase records and follow the agreed edition-access policy.</td></tr>
<tr><td>FR-13</td><td>Manage prices, available formats, stock where applicable, delivery rules and published policies. Hide unavailable formats from checkout.</td></tr>
<tr><td>FR-14</td><td>Admin views orders, payment and delivery states, records dispatch/tracking, resends confirmations and processes authorised refunds. Keep a history of sensitive actions.</td></tr>
<tr><td>FR-15</td><td>Contact and speaking forms validate input, record enquiries and provide acknowledgement. Admin can mark enquiry progress.</td></tr>
<tr><td>FR-16</td><td>Newsletter signup records consent, confirms subscription and supports unsubscribe. Suppressed/unsubscribed addresses must not receive marketing. Campaign authoring inside admin versus an external service is undecided.</td></tr>
<tr><td>FR-17</td><td>Show useful admin summaries of orders, sales, enquiries and drafts. Financial totals distinguish successful payments and refunds; test orders are separated.</td></tr></table>
<h2>Publishing journey</h2><p>Sign in + MFA &gt; create draft &gt; enter both language variants &gt; upload assets and narration &gt; preview &gt; resolve validation issues &gt; publish/schedule &gt; verify public page. Future edits create recoverable revisions.</p>
''')
add('Payment, fulfilment and purchase access', '''
<h2>Buyer journey</h2><p>Discover book &gt; read/listen to sample &gt; choose format &gt; add to cart &gt; review full total &gt; enter email and shipping details if needed &gt; Stripe Checkout &gt; confirmed/pending/failed result &gt; digital access or shipment &gt; support/refund request.</p>
<table><tr><th>ID</th><th>Requirement and acceptance</th></tr>
<tr><td>FR-18</td><td>Server validates prices, currency, quantities, availability and applicable delivery/tax amounts. Browser-supplied totals are never authoritative.</td></tr>
<tr><td>FR-19</td><td>Use Stripe-hosted Checkout. Never store card numbers or security codes. Keep secret keys server-side and separate test/live environments.</td></tr>
<tr><td>FR-20</td><td>Verify webhook signatures and confirm paid status before fulfilment. Handle delayed, failed, repeated and out-of-order events. Fulfil each purchased item only once.</td></tr>
<tr><td>FR-21</td><td>Show clear cancelled, failed and processing states with safe recovery. Success-page visits cannot authorise access. Confirmation emails can be retried without creating a new order.</td></tr>
<tr><td>FR-22</td><td>Use private storage and expiring authorised links for digital books. Deny access to unpaid orders and other buyers' files. Define access after refunds before launch.</td></tr>
<tr><td>FR-23</td><td>For print: capture address, apply configured shipping rules, prevent overselling through stock reservation/reconciliation, and track preparation, dispatch and delivery states.</td></tr>
<tr><td>FR-24</td><td>Support guest purchase recovery through verified, expiring email links. Optional customer accounts provide own library/orders; account model must be confirmed.</td></tr>
<tr><td>FR-25</td><td>Refund requests require review. Only authorised staff initiate refunds. Reflect confirmed Stripe results and update entitlements according to policy.</td></tr></table>
<p><b>State model:</b> Payment: unpaid/pending/paid/failed/partially refunded/refunded. Fulfilment: not started/ready/preparing/dispatched/delivered/cancelled as appropriate. Track payment and fulfilment separately.</p>
''')
add('Security requirements', '''
<table><tr><th>ID</th><th>Required control</th></tr>
<tr><td>SEC-01</td><td>Mandatory admin MFA, secure recovery, rate-limited authentication and individual staff accounts. Use a maintained identity solution or appropriately hashed passwords; never plaintext.</td></tr>
<tr><td>SEC-02</td><td>Secure, HttpOnly session cookies, appropriate SameSite settings, session rotation/expiry/revocation and CSRF protection for cookie-authenticated mutations.</td></tr>
<tr><td>SEC-03</td><td>Authorise every API action and object access on the server. Check order ownership and purchased entitlements; deny access by default.</td></tr>
<tr><td>SEC-04</td><td>Validate inputs, use parameterised database access and sanitise rich text. Configure CSP, HTTPS and appropriate security headers.</td></tr>
<tr><td>SEC-05</td><td>Validate upload extension, actual content/type and size. Generate safe storage names; scan and quarantine files until accepted; restrict public file execution.</td></tr>
<tr><td>SEC-06</td><td>Separate public media from paid files. Rate-limit downloads, forms, login and costly endpoints. Keep email access tokens short-lived, single-use where appropriate and out of logs.</td></tr>
<tr><td>SEC-07</td><td>Keep secrets out of React bundles, repositories and logs. Restrict database/storage credentials; rotate compromised keys and revoke affected sessions.</td></tr>
<tr><td>SEC-08</td><td>Audit staff access changes, publishing, price edits and refunds. Protect logs and avoid storing sensitive payment or unnecessary personal information.</td></tr>
<tr><td>SEC-09</td><td>Automated database/media backups, restricted backup access, monitoring and a documented recovery procedure. Test restoration before launch.</td></tr>
<tr><td>SEC-10</td><td>Patch dependencies and hosting components; assign an operational owner. Alert on suspicious login activity, payment processing failures and service outages.</td></tr></table>
<p><b>Practical limit:</b> Access controls prevent unauthorised retrieval from the service; they cannot prevent redistribution of a legitimately downloaded book. Personalised watermarking is an optional decision.</p>
''')
add('Quality, data and operational requirements', '''
<h2>Non-functional requirements</h2><table><tr><th>ID</th><th>Target</th></tr>
<tr><td>NFR-01</td><td>Target WCAG 2.2 AA for website-owned interfaces: keyboard access, visible focus, semantic structure, labels, contrast and accessible errors. Test Urdu and audio controls.</td></tr>
<tr><td>NFR-02</td><td>Responsive layouts from 320px mobile through desktop, without unintended horizontal overflow. Review Urdu glyph shaping, line height and mixed-script text.</td></tr>
<tr><td>NFR-03</td><td>Proposed performance targets: LCP &lt;= 2.5s, INP &lt;= 200ms and CLS &lt;= 0.1 at the 75th percentile when field data exists. Use lab checks before launch; optimise covers/fonts and defer audio/video loading.</td></tr>
<tr><td>NFR-04</td><td>Search-visible public content with language-specific titles, descriptions, canonical/alternate-language links and sitemap. Use pre-rendering/server rendering strategy agreed in Chunk 1.</td></tr>
<tr><td>NFR-05</td><td>Proposed recovery targets for agreement: daily backups, maximum 24-hour data loss, and restoration within one working day. Validate hosting capabilities and owner responsibilities.</td></tr>
<tr><td>NFR-06</td><td>Clear loading, empty, error and unavailable-translation states. Provider failures must not erase orders or prevent access to unrelated public content.</td></tr></table>
<h2>Core records</h2><p>Users/roles/sessions; content items and language variants; revisions/schedules; books/editions/formats; articles/categories; media/audio by locale; products/prices/stock; orders/items/payment events/refunds; download entitlements; shipments; subscribers/consent; enquiries; settings and audit events.</p>
<h2>Privacy and retention</h2><p>Store only required customer/contact data. Define retention and deletion rules, newsletter consent wording, access to customer records and handling of deletion requests before launch. Keep financial records according to the merchant's applicable obligations.</p>
<h2>Operational handover</h2><p>Deliver a publishing guide, fulfilment/refund guide, backup/restore procedure, provider inventory and incident contacts. Agree maintenance frequency and ownership; availability guarantees depend on selected hosting and support.</p>
''')
add('Acceptance tests and release gates', '''
<table><tr><th>Test</th><th>Pass condition</th></tr>
<tr><td>AT-01 Design</td><td>Homepage matches the reference's structure and styling; approved responsive adaptations work in both languages.</td></tr>
<tr><td>AT-02 Languages</td><td>Equivalent-page switch, RTL, forms and missing-translation notices work without broken navigation.</td></tr>
<tr><td>AT-03 Audio</td><td>Correct-language narration works on each launch content page; controls work by keyboard; changing content stops previous playback.</td></tr>
<tr><td>AT-04 Publishing</td><td>Admin adds a book and article with both languages/media, previews, publishes, edits and restores a revision.</td></tr>
<tr><td>AT-05 Permissions</td><td>Anonymous users cannot call admin APIs; editor cannot refund/manage staff; customer cannot access another order.</td></tr>
<tr><td>AT-06 Payments</td><td>Test success, decline, cancel and pending flows; altered browser price is rejected; forged notification is rejected; repeated events fulfil once.</td></tr>
<tr><td>AT-07 Delivery</td><td>Paid buyer receives correct file/access; unpaid buyer and expired links are denied. Physical stock/address/tracking paths pass if enabled.</td></tr>
<tr><td>AT-08 Recovery</td><td>Lost confirmation email can be recovered securely; refund and access updates follow policy; failed emails can be retried.</td></tr>
<tr><td>AT-09 Abuse</td><td>Disallowed uploads and malicious article HTML are rejected/sanitised; rate limits work; secrets are absent from frontend assets.</td></tr>
<tr><td>AT-10 Engagement</td><td>Enquiry acknowledgement, newsletter confirmation, consent and unsubscribe work.</td></tr>
<tr><td>AT-11 Operations</td><td>Restore a backup in an isolated environment, verify alerts and document operational ownership.</td></tr></table>
<h2>Release rule</h2><p>No unresolved critical/high security defects, broken purchase flows or missing launch-content approvals. Complete mobile/desktop and English/Urdu review. Activate live Stripe only after merchant eligibility, policy content and live configuration are confirmed.</p>
''')
add('Open decisions and next actions', '''
<h2>Decisions required in Chunk 1</h2><table><tr><th>Decision</th><th>Proposed baseline / consequence</th></tr>
<tr><td>Book formats</td><td>Confirm print, digital or both; determines shipping, stock and protected delivery scope.</td></tr>
<tr><td>Stripe merchant</td><td>Confirm legal seller and account country. Pakistan is absent from Stripe's current supported-country list; eligibility is a live-payment dependency.</td></tr>
<tr><td>Store rules</td><td>Confirm currency, selling/shipping regions, rates, applicable tax setup and refund policy.</td></tr>
<tr><td>Audio production</td><td>Uploaded author/narrator recordings proposed. Confirm English/Urdu coverage, who produces audio, and the interpretation of "every page".</td></tr>
<tr><td>Languages/content</td><td>Urdu-first proposed. Confirm approved Urdu spelling of the author's name, translations, initial articles and content ownership/permissions.</td></tr>
<tr><td>Customer access</td><td>Guest checkout with verified-email recovery and optional accounts proposed. Confirm account requirement and digital reading/download formats.</td></tr>
<tr><td>Admin and newsletter</td><td>Confirm staff roles and campaign management inside admin versus an external email platform.</td></tr>
<tr><td>Infrastructure</td><td>Select backend, database, storage, hosting, domain, email providers and recurring budget; confirm maintenance ownership.</td></tr></table>
<h2>Assets needed</h2><p>Author portrait and bilingual biography; five book covers, titles, publication details, descriptions, prices, samples and sellable files; initial articles and narration; video/social links; contact information; approved policies.</p>
<h2>Reference guidance</h2><p>Design PDF and pasted notes supplied by user. Security baseline: OWASP Authentication Cheat Sheet (cheatsheetseries.owasp.org). Payments: docs.stripe.com/checkout/fulfillment and docs.stripe.com/webhooks/signature. Merchant availability: stripe.com/global. Guidance checked during planning on 29 October 2026; recheck at integration.</p>
<p><b>Next step:</b> Review and settle Chunk 1 decisions. Then implement the bilingual homepage as the first visible design review. This SRS does not authorise an unrequested redesign or imply that unresolved options are confirmed.</p>
''')

add('Registration and user information', '''
<p><b>Scope update - 30 October 2026:</b> User registration is included at launch. Public reading/listening remains available without registration. Whether checkout requires an account is still a decision; guest checkout remains the proposed baseline.</p>
<h2>Registration journey</h2><p>Choose English/Urdu &gt; open Create account &gt; enter name, email and password &gt; accept terms and acknowledge privacy notice &gt; optionally opt in to newsletter &gt; submit &gt; receive verification link &gt; verify email &gt; complete optional profile &gt; return to the page or cart that started registration.</p>
<table><tr><th>Data</th><th>Collection rule</th></tr>
<tr><td>Core</td><td>Name, unique verified email, account identifier, securely hashed password or identity-provider reference, preferred language, account status and timestamps.</td></tr>
<tr><td>Optional profile</td><td>Country/city, reading interests and phone number. Explain their purpose; do not block registration if omitted.</td></tr>
<tr><td>Order details</td><td>Collect delivery address and any carrier-required contact details only for printed orders. Let customers choose whether to save an address.</td></tr>
<tr><td>Consent</td><td>Record terms version and acceptance time; record marketing consent separately with source/time. Marketing checkbox is unchecked by default.</td></tr>
<tr><td>Excluded</td><td>No national ID, date of birth or sensitive demographics in the baseline. No card data or plaintext passwords.</td></tr></table>
<h2>Account journeys</h2><p><b>Login:</b> submit credentials &gt; authenticate &gt; return to intended page. Unverified accounts receive a verification prompt; resends are rate-limited.</p>
<p><b>Recovery:</b> request reset &gt; neutral acknowledgement &gt; receive expiring single-use link &gt; set new password &gt; revoke previous sessions &gt; sign in again.</p>
<p><b>Profile:</b> view/edit own information and interests; update language and marketing preferences; verify a new email before replacing the current address.</p>
<p><b>Account closure:</b> request export or deletion &gt; verify identity &gt; process under published retention rules. Explain retained transaction records and consequences for purchase access before confirmation.</p>
''')
add('Account controls and updated planning', '''
<table><tr><th>ID</th><th>Requirement / verification</th></tr>
<tr><td>FR-26</td><td>Provide bilingual registration, login, logout, email verification and password recovery. Expired/reused verification or reset tokens are rejected; safe resend is available.</td></tr>
<tr><td>FR-27</td><td>Provide My profile, My library, My orders and communication preferences. Users can access only their own records. User registration never grants staff privileges.</td></tr>
<tr><td>FR-28</td><td>Admin can search users by authorised fields, inspect verification/status, view related orders and consent, and suspend/reactivate with a recorded reason. Suspension revokes active sessions.</td></tr>
<tr><td>FR-29</td><td>Mask unnecessary contact data and restrict customer management to permitted roles. Never display passwords, reset links or authentication secrets. No silent impersonation feature.</td></tr>
<tr><td>FR-30</td><td>Show aggregate registered/verified users, language preferences and voluntarily supplied interests. Identify unknown/missing values; no undisclosed behavioural tracking.</td></tr>
<tr><td>FR-31</td><td>Link prior guest purchases only after proof of email ownership; never merge records merely because an unverified registration supplied the same email.</td></tr>
<tr><td>AT-12</td><td>Test duplicate registration without account enumeration, valid/expired/reused verification links, resend limits, login, reset, logout, email change and session revocation.</td></tr>
<tr><td>AT-13</td><td>Test profile ownership, newsletter opt-in/out, admin permissions, suspension and verified purchase linking. Confirm omitted optional fields do not block signup.</td></tr></table>
<h2>Changes to delivery chunks</h2><p><b>Chunk 1:</b> Agree profile fields, account/guest checkout rule, identity provider and retention policy. <b>Chunk 2:</b> Review bilingual signup/login/profile screens. <b>Chunk 3:</b> Implement customer authentication and admin user controls alongside staff access. <b>Chunk 4:</b> Deliver profiles and account navigation. <b>Chunk 5:</b> Connect library/orders and verified purchase linking. <b>Chunks 6-7:</b> Verify consent, recovery, privacy and full account security.</p>
<h2>Chunk 1 working baseline</h2><p>Confirmed: React; supplied design; English/Urdu; content-page audio; admin publishing; registration; Stripe integration intent. Proposed: Urdu-first, uploaded narration, guest checkout plus registration, minimal required profile fields. Open: formats, merchant country, currency/shipping, provider choices and launch assets.</p>
<p><b>Version note:</b> v1.1 supersedes v1.0. Earlier references to optional customer accounts now mean optional account use by readers/guest buyers, not an optional registration feature. Added FR-26 through FR-31 and AT-12 through AT-13.</p>
''')
# Keep the earlier baseline consistent with the now-required registration feature.
pages=[(title,body.replace('Version:</b> 1.0','Version:</b> 1.1').replace('29 October 2026<br>','30 October 2026<br>').replace('optional customer account, library and orders','customer registration/account, library and orders').replace('Optional customer accounts provide own library/orders; account model must be confirmed.','Customer accounts provide own library/orders; whether checkout requires an account must be confirmed.')) for title,body in pages]

css=''
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
path=OUT/'Dr-Manzar-Website-SRS-v1.1.pdf'
styles=getSampleStyleSheet()
styles.add(ParagraphStyle(name='Copy',fontName='Helvetica',fontSize=9,leading=12,spaceAfter=8))
styles.add(ParagraphStyle(name='Cell',fontName='Helvetica',fontSize=8,leading=11))
styles['Heading1'].textColor=colors.HexColor('#792f3d')
styles['Heading1'].fontSize=22
styles['Heading1'].leading=26
styles['Heading2'].textColor=colors.HexColor('#792f3d')
styles['Heading2'].fontSize=12
story=[]
def inner(el):
    return (el.text or '')+''.join(ET.tostring(c,encoding='unicode') for c in el)
for idx,(title,body) in enumerate(pages):
    if idx: story.append(PageBreak())
    story.append(Paragraph(title,styles['Heading1']))
    root=ET.fromstring('<root>'+body.replace('<br>','<br/>')+'</root>')
    for el in root:
        if el.tag in ('p','h2'):
            story.append(Paragraph(inner(el),styles['Heading2' if el.tag=='h2' else 'Copy']))
        elif el.tag=='ul':
            for li in el: story.append(Paragraph('&#8226; '+inner(li),styles['Copy']))
        elif el.tag=='table':
            rows=[[Paragraph(inner(c),styles['Cell']) for c in tr] for tr in el]
            cols=len(rows[0]); widths=[68,443] if cols==2 else [75,253,183]
            t=Table(rows,colWidths=widths,hAlign='LEFT')
            t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#eee4df')),('VALIGN',(0,0),(-1,-1),'TOP'),('BOTTOMPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('LINEBELOW',(0,0),(-1,-1),.4,colors.HexColor('#d8cfc9'))]))
            story.extend([t,Spacer(1,10)])
def footer(c,d):
    c.setFillColor(colors.HexColor('#792f3d')); c.rect(0,830,595,12,fill=1,stroke=0)
    c.setFont('Helvetica',8); c.setFillColor(colors.grey)
    c.drawString(42,811,'DR. MANZAR UL HAQUE / SRS v1.1')
    c.drawString(42,24,'Planning baseline | 30 October 2026')
    c.drawRightString(553,24,str(d.page))
SimpleDocTemplate(str(path),pagesize=(595,842),rightMargin=42,leftMargin=42,topMargin=55,bottomMargin=43,title='Dr. Manzar ul Haque - SRS and Delivery Plan').build(story,onFirstPage=footer,onLaterPages=footer)
import pypdfium2 as pdfium
doc=pdfium.PdfDocument(str(path))
qa=Path('tmp/pdfs'); qa.mkdir(parents=True,exist_ok=True)
for i in range(len(doc)): doc[i].render(scale=1.2).to_pil().save(qa/f'srs-{i+1:02}.png')
print(f'Created {path.resolve()} ({len(doc)} pages).')
