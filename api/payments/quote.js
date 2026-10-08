import paymentApi from "../../server/payment-api.js";
export default (request, response) => paymentApi("quote", request, response);
