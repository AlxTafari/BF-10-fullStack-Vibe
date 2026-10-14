import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import type { ApiError } from "./errors";

// Запросов по HTTP через RTK нет: queryFn вызывают supabase-js, поэтому fakeBaseQuery.
export const baseApi = createApi({
  reducerPath: "api",
  baseQuery: fakeBaseQuery<ApiError>(),
  tagTypes: ["Restaurant", "Faq", "MenuCategory", "MenuItem", "BookingList", "GuestRequestList", "Booking", "GuestRequest", "OpenCounts"],
  endpoints: () => ({}),
});
