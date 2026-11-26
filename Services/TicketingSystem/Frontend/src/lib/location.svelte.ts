import { page } from '$app/state';

export const location = {
    get search() {
        return page.url.search;
    }
};
