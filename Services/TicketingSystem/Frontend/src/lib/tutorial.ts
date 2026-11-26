import { driver } from "driver.js";
import "driver.js/dist/driver.css";

export const createTicketTour = () => {
  const driverObj = driver({
    showProgress: true,
    steps: [
      {
        popover: {
          title: "Welcome to Ticket Creation",
          description: "This quick guide will show you how to file a ticket correctly so our team can help you faster.",
        },
      },
      {
        element: '[data-tour="ticket-subject"]',
        popover: {
          title: "Ticket Subject",
          description: "Provide a concise, descriptive title of the issue. Avoid vague subjects like 'Help' or 'Error'.",
        },
      },
      {
        element: '[data-tour="ticket-description"]',
        popover: {
          title: "Issue Description",
          description: "Describe what happened, what you expected, and what you tried. Paste tables from Excel here; pasted screenshots are added as attachments below.",
        },
      },
      {
        element: '[data-tour="ticket-request-type"]',
        popover: {
          title: "Request Type",
          description: "Select what kind of request this is (e.g., Software, Hardware, Access).",
        },
      },
      {
        element: '[data-tour="ticket-system"]',
        popover: {
          title: "Affected System",
          description: "Which system is having issues? (e.g., HRIS, Payroll, Email). Use 'Others' if not listed.",
        },
      },
      {
        element: '[data-tour="ticket-department"]',
        popover: {
          title: "Target Department",
          description: "Which department should handle this request? Usually MIS for IT issues.",
        },
      },
      {
        element: '[data-tour="ticket-attachments"]',
        popover: {
          title: "Attachments",
          description: "Upload screenshots, error logs, or documents that can help us understand the issue better.",
        },
      },
      {
        element: '[data-tour="ticket-approval"]',
        popover: {
          title: "Requires Approval",
          description: "Check this if your request requires manager approval (e.g., new software, access requests).",
        },
      },
      {
        element: '[data-tour="ticket-submit"]',
        popover: {
          title: "Ready to go!",
          description: "Once everything is filled out, click here to submit your ticket. We'll take it from there!",
        },
      },
    ],
    onDestroyed: () => {
        localStorage.setItem("tour_ticket_create_seen", "true");
    }
  });

  return driverObj;
};

export const startTourIfNeverSeen = (tourId: string, tourFn: () => any) => {
    const seen = localStorage.getItem(`tour_${tourId}_seen`);
    if (!seen) {
        tourFn().drive();
    }
}
