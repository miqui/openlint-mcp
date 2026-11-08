export default input =>
  input !== null && typeof input === 'object' && input.title ? [] : [{ message: 'info.title is required' }];
