import type { AgreementData } from "./agreement";

/**
 * The stand-in party used to PREVIEW a template.
 *
 * ── IT IS OBVIOUSLY FAKE ON PURPOSE ─────────────────────────────────────────────────────────
 * "Sample Student", a 0001 document number, an address nobody lives at. A preview filled with a
 * plausible-looking name and a real-looking address is one screenshot away from being mistaken
 * for somebody's actual contract - and this renders through the very same function the executed
 * copy does, so the output is a genuine-looking agreement in every other respect.
 *
 * The MONEY, though, is realistic: 69,999 INR over two instalments is the shape the Guided Mode
 * programme actually sells, so `{{payment.schedule}}` previews at the length it will really be
 * and a founder can see whether the table fits. A preview that lies about size is no preview.
 */
export const SAMPLE_AGREEMENT_DATA: AgreementData = {
  student: {
    fullName: "Sample Student",
    address: "1 Example Street, Sampletown 000000",
    phone: "+910000000000",
    email: "sample@example.com",
  },
  batch: { number: "Batch 00", startDate: "2026-01-01" },
  payment: {
    option: "INSTALMENT",
    totalInrMinor: "6999900",
    instalments: [
      { amountInrMinor: "4399900", dueMilestone: "Before commencement of Week 1", dueDate: "2026-01-01" },
      {
        amountInrMinor: "2600000",
        dueMilestone: "Before the commencement of 2nd Sprint Week",
        dueDate: "2026-02-01",
      },
    ],
  },
};
