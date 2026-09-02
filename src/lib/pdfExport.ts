import jsPDF from "jspdf";
import html2canvas from "html2canvas";

/** Renders an off-screen HTML string to a paginated A4 PDF and triggers a download. */
export async function renderHtmlToPDF(html: string, filename: string, widthPx = 800) {
  const container = document.createElement("div");
  container.style.cssText = `position:fixed;left:-99999px;top:0;width:${widthPx}px;background:#ffffff;`;
  container.innerHTML = html;
  document.body.appendChild(container);
  try {
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: "#ffffff", windowWidth: widthPx });
    const pdf = new jsPDF("p", "mm", "a4");
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    const imgData = canvas.toDataURL("image/png");
    let heightLeft = imgHeight;
    let position = 0;
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
    while (heightLeft > 0) {
      position = heightLeft - imgHeight;
      pdf.addPage();
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }
    pdf.save(filename);
  } finally {
    document.body.removeChild(container);
  }
}

export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The app's branded report header — shared by every PDF export so they all read as one family of document. */
export function reportHeader(kicker: string, metaLines: string[]): string {
  return `
    <div style="display:flex;align-items:center;gap:10px;border-bottom:3px solid #009f3d;padding-bottom:16px;">
      <div style="width:36px;height:36px;border-radius:9px;background:linear-gradient(135deg,#40b76e,#00722c);"></div>
      <div>
        <div style="font-size:19px;font-weight:800;">DOINg.Catalogue</div>
        <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em;">${escHtml(kicker)}</div>
      </div>
      <div style="margin-left:auto;text-align:right;font-size:11px;color:#94a3b8;">
        ${metaLines.map((l) => `<div>${escHtml(l)}</div>`).join("")}
      </div>
    </div>`;
}

export function reportFooter(text: string): string {
  return `
    <div style="margin-top:28px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:10px;color:#94a3b8;">
      ${escHtml(text)}
    </div>`;
}

export const REPORT_FONT = "font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif;";
