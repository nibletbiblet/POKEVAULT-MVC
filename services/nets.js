const fetch = (...args) =>
  import('node-fetch').then(({ default: fetchFn }) => fetchFn(...args));

exports.generateQrCode = async (req, res) => {
  const { cartTotal } = req.body;

  if (!cartTotal || Number(cartTotal) <= 0) {
    console.error("Invalid NETS cartTotal:", cartTotal);
    return res.redirect("/nets-qr/fail");
  }

  try {
    const requestBody = {
      txn_id: "sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b",
      amt_in_dollars: cartTotal,
      notify_mobile: 0,
    };

    const response = await fetch(
      "https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/request",
      {
        method: 'POST',
        headers: {
          "api-key": process.env.API_KEY,
          "project-id": process.env.PROJECT_ID,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      }
    );

    const data = await response.json();
    const qrData = data?.result?.data;

    if (
      qrData &&
      qrData.response_code === "00" &&
      qrData.txn_status === 1 &&
      qrData.qr_code
    ) {
      const txnRetrievalRef = qrData.txn_retrieval_ref;

      // 🔒 IMPORTANT
      // Do NOT override session logic here.
      // app.js already sets:
      // - req.session.netsPayment for ORDER or WALLET_TOPUP
      // This service only generates QR.

      res.render("nets/netsQr", {
        title: "Scan to Pay",
        total: cartTotal,
        qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
        txnRetrievalRef,
        apiKey: process.env.API_KEY,
        projectId: process.env.PROJECT_ID,
        timer: 300,
      });

    } else {
      console.error("NETS QR generation failed:", qrData);
      res.redirect("/nets-qr/fail");
    }

  } catch (error) {
    console.error("Error in generateQrCode:", error.message);
    res.redirect("/nets-qr/fail");
  }
};
