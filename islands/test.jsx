
const MyForm = () => {

  return (
    <form onSubmit={handleSubmit(onSubmit)}>
      <input {...register("firstName")} />
      <input {...register("lastName")} />
      {errors.lastName && <p>{errors.lastName.message}</p>} 
      <button type="submit">Submit</button>
    </form>
  );
};

export default MyForm;

