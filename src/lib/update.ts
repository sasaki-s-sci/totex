/**
 * Declaring the two versions the app should be adjusted to.
 *
 * Core is the independently released application layer. Front / Program is a
 * full app release, filtered to the ones that speak the selected Core's
 * protocol. The backend still takes the three physical layers one at a time;
 * the settings present them as the two declarations a person actually makes.
 */

export * from "./update/model";
export * from "./update/store";
export * from "./update/take";
