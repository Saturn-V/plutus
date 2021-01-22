import * as BillsData from "../bills.data.json";

const SEARCH_DAY_LIMIT = Number(process.env.SEARCH_DAY_LIMIT) || (13 as const);

enum CardSource {
  Debit = "DEBIT",
  Amex = "AMEX",
  AppleCard = "APPLE_CARD",
  CapitalOneCard = "CAPITAL_ONE_CARD",
}

enum DueDateType {
  Yearly = "YEARLY",
  Monthly = "MONTHLY",
  BiWeekly = "BI_WEEKLY",
  Weekly = "WEEKLY",
  Daily = "DAILY",
}

interface Bill {
  owner: string | null;
  name: string;
  amountDue: number; // float, really..
  dueDayOfMonth: number;
  dueDate: { date: number; type: DueDateType };
  isSignificant: boolean;
  reasonForDeferment: string | null;
  comment: string | null;
  amountDueCanVary: boolean;
  isPaid: boolean;
  cardSource: CardSource;
}

interface BillWithActualDueDate extends Bill {
  actualDueDate: Date;
}

function isBill(bill: any): bill is Bill {
  const {
    owner,
    name,
    amountDue,
    dueDayOfMonth,
    dueDate,
    isSignificant,
    reasonForDeferment,
    comment,
    amountDueCanVary,
    isPaid,
    cardSource,
  } = bill;
  const isOwnerValid = owner !== undefined;
  const isNameValid = !!name;
  const isAmountDueValid = typeof amountDue === "number";
  const isDueDayOfMonthValid = typeof dueDayOfMonth === "number";
  const isDueDateValid =
    typeof dueDate === "object" &&
    typeof dueDate.date === "number" &&
    Object.values(DueDateType).includes(dueDate.type);
  const isIsSignificantValid = typeof isSignificant === "boolean";
  const isReasonForDefermentValid = reasonForDeferment !== undefined;
  const isCommentValid = comment !== undefined;
  const isAmountDueCanVaryValid = typeof amountDueCanVary === "boolean";
  const isIsPaidValid = typeof isPaid === "boolean";
  const isCardSourceValid = Object.values(CardSource).includes(cardSource);
  return (
    isOwnerValid &&
    isNameValid &&
    isAmountDueValid &&
    isDueDayOfMonthValid &&
    isDueDateValid &&
    isIsSignificantValid &&
    isReasonForDefermentValid &&
    isCommentValid &&
    isAmountDueCanVaryValid &&
    isIsPaidValid &&
    isCardSourceValid
  );
}
function getBillsByOwner(
  billsData: any[]
): { billsByOwner: { [owner: string]: Bill[] }; malformedBills: Bill[] } {
  const billsByOwner: { [owner: string]: Bill[] } = {};
  const malformedBills: any[] = [];
  for (const billData of billsData) {
    if (isBill(billData)) {
      if (!billsByOwner[billData.owner]) {
        billsByOwner[billData.owner] = [];
      }
      billsByOwner[billData.owner].push(billData);
      continue;
    }
    console.warn(`skipping malformed bill..`);
    malformedBills.push(billData);
  }
  return { billsByOwner, malformedBills };
}

function sortBills(bills: BillWithActualDueDate[]): BillWithActualDueDate[] {
  return bills.sort((a, b) => {
    if (a.actualDueDate < b.actualDueDate) return -1;
    if (a.actualDueDate > b.actualDueDate) return 1;
    return 0;
  });
}

function patchBills(
  bills: Bill[],
  fromDate: Date,
  toDate: Date
): BillWithActualDueDate[] {
  let patched: BillWithActualDueDate[] = [];
  for (const bill of bills) {
    const actualBillDueDates = getBillDueDates(fromDate, toDate, bill);
    patched = patched.concat(
      actualBillDueDates.map((actualDueDate) => ({ ...bill, actualDueDate }))
    );
  }
  return patched;
}

function getBillDueDates(
  fromDate: Date,
  toDate: Date,
  bill: Bill | BillWithActualDueDate
): Date[] {
  const currentDay = fromDate.getDate();
  const year = fromDate.getFullYear();
  if (bill.dueDate.type === DueDateType.Monthly) {
    return [
      new Date(
        year,
        fromDate.getMonth() !== toDate.getMonth() &&
        bill.dueDate.date < currentDay
          ? toDate.getMonth()
          : fromDate.getMonth(),
        bill.dueDate.date
      ),
    ];
  }
  if (bill.dueDate.type === DueDateType.Weekly) {
    const dates: Date[] = [];
    let day = fromDate.getDate();
    let month = fromDate.getMonth();
    while (true) {
      const d = new Date(year, month, day);
      if (
        d.getMonth() === toDate.getMonth() &&
        d.getDate() === toDate.getDate()
      ) {
        break;
      }
      if (d.getDay() === bill.dueDate.date) {
        dates.push(d);
      }
      day += 1;
    }
    return dates;
  }

  if (bill.dueDate.type === DueDateType.BiWeekly) {
    const dates: Date[] = [];
    let day = fromDate.getDate();
    let month = fromDate.getMonth();
    let skipWeek = true;
    while (true) {
      const d = new Date(year, month, day);

      // we reached our query limit
      if (
        d.getMonth() === toDate.getMonth() &&
        d.getDate() === toDate.getDate()
      ) {
        break;
      }

      // we found our due date
      if (d.getDay() === bill.dueDate.date) {
        if (skipWeek) {
          skipWeek = false;
        } else {
          dates.push(d);
          skipWeek = true;
        }
      }
      day += 1;
    }
    return dates;
  }
}

function isBillInDateRange(
  fromDate: Date,
  toDate: Date,
  bill: BillWithActualDueDate
): boolean {
  const currentDay = fromDate.getDate();
  const actualBillDueDates = getBillDueDates(fromDate, toDate, bill);
  // const actualBillDueDate = new Date(
  //   fromDate.getFullYear(),
  //   fromDate.getMonth() !== toDate.getMonth() && bill.dueDayOfMonth < currentDay
  //     ? toDate.getMonth()
  //     : fromDate.getMonth(),
  //   bill.dueDayOfMonth
  // );
  for (const dueDate of actualBillDueDates) {
    if (fromDate.getMonth() === toDate.getMonth()) {
      return (
        dueDate.getDate() >= currentDay && dueDate.getDate() <= toDate.getDate()
      );
    }
    if (dueDate.getMonth() === fromDate.getMonth()) {
      if (bill.name === "Rent")
        console.log(
          "same month due date",
          dueDate.toDateString(),
          JSON.stringify(bill, null, 2)
        );
      const lastDayInMonth = new Date(
        fromDate.getFullYear(),
        fromDate.getMonth(),
        0
      ).getDate();
      return (
        dueDate.getDate() >= currentDay && dueDate.getDate() <= lastDayInMonth
      );
    }
    if (dueDate.getMonth() === toDate.getMonth()) {
      return dueDate.getDate() <= toDate.getDate();
    }
  }
  return false;
}

function displayBills(
  billsByOwner: { [owner: string]: Bill[] },
  fromDateParts: DateParts,
  desiredOwner?: string
): void {
  const { year, month, day } = fromDateParts;
  const fromDate = new Date(year, month, day);
  const toDate = new Date(
    fromDate.getFullYear(),
    fromDate.getMonth(),
    fromDate.getDate() + SEARCH_DAY_LIMIT
  );

  for (const [owner, bills] of Object.entries(billsByOwner)) {
    const notDesiredOwner = desiredOwner && owner !== desiredOwner;
    if (notDesiredOwner) continue;

    const ownerText = owner === "null" ? "Family" : owner;
    console.log("-- BILLS --------------------------------------------");
    console.log(`OWNER: ${ownerText}`);

    const unpaidBills: BillWithActualDueDate[] = [];
    const paidBills: BillWithActualDueDate[] = [];
    const deferredBills: BillWithActualDueDate[] = [];
    const billsByCard: { [cs in CardSource]: BillWithActualDueDate[] } = {
      [CardSource.Amex]: [],
      [CardSource.AppleCard]: [],
      [CardSource.CapitalOneCard]: [],
      [CardSource.Debit]: [],
    };
    let totalAmount = 0.0;
    let totalAmountDue = 0.0;
    let totalAmountPaid = 0.0;
    let totalAmountDeferred = 0.0;
    for (const bill of sortBills(patchBills(bills, fromDate, toDate))) {
      const outOfDateRange = !isBillInDateRange(fromDate, toDate, bill);
      if (outOfDateRange) continue;
      if (bill.isSignificant) continue;

      totalAmount += bill.amountDue;
      if (bill.reasonForDeferment) {
        deferredBills.push(bill);
        totalAmountDeferred += bill.amountDue;
        continue;
      }

      billsByCard[bill.cardSource].push(bill);
      totalAmountDue += bill.amountDue;
      if (bill.isPaid || bill.actualDueDate <= new Date()) {
        paidBills.push(bill);
        totalAmountPaid += bill.amountDue;
        continue;
      }
      unpaidBills.push(bill);
    }

    console.log(`\nSUMMARY`);
    // final edits
    // const significantBills = bills.filter(({ isSignificant }) => isSignificant);
    // for (const bill of significantBills) {
    //   if (bill.isPaid)
    // }

    console.log("\nOverview");
    unpaidBills.forEach((bill) => {
      console.log(`\n${bill.name}`);
      console.log("Amount:", bill.amountDueCanVary ? "~" : "", bill.amountDue);
      console.log("Due:   ", bill.actualDueDate.toDateString());
      console.log("Comment: ", bill.comment || "");
      console.log("Card: ", bill.cardSource);
    });
    paidBills.forEach((bill) =>
      console.log(
        `\nPAID: ${bill.name}\nAmount: ${bill.amountDueCanVary ? "~" : ""}${
          bill.amountDue
        }\nDue: ${bill.actualDueDate.toDateString()}\nCard: ${bill.cardSource}${
          bill.comment ? `\nComment: ${bill.comment}` : ""
        }`
      )
    );
    deferredBills.forEach((bill) => {
      console.log(`\nDEFERRED: ${bill.name}`);
      console.log(`Reason: ${bill.reasonForDeferment}`);
    });

    console.log("\nBy Card");
    for (const [card, subsetBills] of Object.entries(billsByCard)) {
      console.log("\n", card);
      console.log(
        "Amount: ",
        subsetBills.reduce((total, { amountDue }) => {
          total += amountDue;
          return total;
        }, 0)
      );
      console.log(subsetBills.map(({ name }) => name).join("\n"));
    }

    const dueOfTotal = totalAmountDue - totalAmountPaid;
    console.log(
      `\nTotal amount due\nfrom: ${fromDate.toDateString()}\nto: ${toDate.toDateString()}\nDue of Total: ${dueOfTotal.toFixed(
        2
      )} of ${totalAmountDue.toFixed(
        2
      )}\nPaid: ${totalAmountPaid}\nDeferred: ${totalAmountDeferred}\nAbsolute total: ${totalAmount.toFixed(
        2
      )}\nTake Home: ${3988.16 - totalAmountDue}`
    );
  }
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}
interface CliArguments extends DateParts {}

function exitMissingCliArguments(message: string): void {
  console.error(message);
  process.exit(0);
}

function parseCliArguments(): CliArguments {
  const year = Number(process.env.YEAR);
  if (isNaN(year)) exitMissingCliArguments("missing env var YEAR");
  const month = Number(process.env.MONTH);
  if (isNaN(month)) exitMissingCliArguments("missing env var MONTH");
  const day = Number(process.env.DAY);
  if (isNaN(day)) exitMissingCliArguments("missing env var DAY");
  return {
    year,
    month,
    day,
  };
}

function main() {
  const dateParts = parseCliArguments();

  const { billsByOwner, malformedBills } = getBillsByOwner(BillsData.bills);

  displayBills(billsByOwner, dateParts);

  if (malformedBills.length) {
    console.warn("\n\nMalformed bills found:");
    console.log(malformedBills.map((bill) => JSON.stringify(bill, null, 2)));
  }
}

main();

// 39+32.84+99+25.39+11.91+15.57+33.60+12.10+120+2.50+62.32+6+22.92 = 483.15 to transfer to main account
// + todo laundry
// 2295.92+483.15 - 2750 + 3132.89 = 3161.96 // how much we have to use
// 3161.96 - 1500 - 489.04 = 1,172.92 // how much we have to spend after CC payments
// 1,172.92 - 755 + 80.90 = 498.82 // amount to transfer
// 498.82 - 175 = 323.82 // amount to save to pay Amex later this month

// 1500 PAID on Apple Card
// 489.04 PAID on Capital One
// 951.55 DUE on Amex
// 1,010.96 remaining to pay off credit cards. dispurse throughout month
// so we can still pay bills as they come up

// take home amount will be x + 80.90 for thor's crate
