import employeeApi from "../../server/employee-api.js";
export default (request, response) => employeeApi("updateEmployee", request, response);
