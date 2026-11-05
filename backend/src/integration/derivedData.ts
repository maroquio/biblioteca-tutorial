import { invalidateAuthorSearch } from "../modules/authorship";
import { invalidateReaderSearch } from "../modules/readers";


export async function refreshDerivedData(): Promise<void> {
  await invalidateAuthorSearch();
  await invalidateReaderSearch();
}
