export default function checkTitle(input) {
  return input !== null && typeof input === 'object' && input.title ? [] : [{ message: 'info.title is required' }];
}
