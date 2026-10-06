import employeeApi from "../../server/employee-api.js";
export default (request, response) => employeeApi("loginEmployee", request, response);
